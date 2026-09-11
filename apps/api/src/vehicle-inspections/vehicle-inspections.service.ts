import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, VehicleInspectionStatus } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { S3Service } from '@htownautos/common';
import { CreateVehicleInspectionDto } from './dto/create-vehicle-inspection.dto';
import { UpdateVehicleInspectionDto } from './dto/update-vehicle-inspection.dto';
import { ListVehicleInspectionsDto } from './dto/list-vehicle-inspections.dto';
import { CreateChecklistItemDto } from './dto/create-checklist-item.dto';
import { UpdateChecklistItemDto } from './dto/update-checklist-item.dto';
import { CreateRequestItemDto } from './dto/create-request-item.dto';
import { UpdateRequestItemDto } from './dto/update-request-item.dto';
import { CreateInspectionErrorCodeDto } from './dto/create-inspection-error-code.dto';
import { UpdateInspectionErrorCodeDto } from './dto/update-inspection-error-code.dto';
import { DEFAULT_CHECKLIST } from './checklist-template';
import { NotificationsService } from '../notifications/notifications.service';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MIN_LEAD_HOURS = 48;

// Parse Copart-style saleDate (YYYYMMDD as int) + saleTime ("HH:mm")
// into a UTC Date. Returns null when the date can't be parsed.
function parseAuctionDateTime(
  saleDate: number | null | undefined,
  saleTime: string | null | undefined,
): Date | null {
  if (!saleDate || saleDate === 0) return null;
  const str = saleDate.toString();
  if (str.length !== 8) return null;
  const year = Number(str.slice(0, 4));
  const month = Number(str.slice(4, 6)) - 1;
  const day = Number(str.slice(6, 8));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  let hours = 0;
  let minutes = 0;
  if (saleTime) {
    const m = saleTime.match(/^(\d{1,2}):(\d{2})/);
    if (m) {
      hours = Number(m[1]);
      minutes = Number(m[2]);
    }
  }
  return new Date(Date.UTC(year, month, day, hours, minutes));
}

// Shape of a User returned alongside an inspection (sharedWith list).
// Kept narrow on purpose — UI just needs name/email for the chips.
const SHARED_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  firstName: true,
  lastName: true,
  avatar: true,
} satisfies Prisma.UserSelect;

// Brief buyer shape attached to every inspection so the dashboard can show
// who requested / purchased the inspection (list column + detail field).
const BUYER_BRIEF_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
} satisfies Prisma.BuyerSelect;

// Pulled in by every "get inspection" call. Includes the checklist (ordered)
// with each item's media, plus the inspection-level media (top-level videos).
const INSPECTION_INCLUDE = {
  media: { orderBy: { createdAt: 'asc' as const } },
  checklist: {
    orderBy: [
      { sortOrder: 'asc' as const },
      { createdAt: 'asc' as const },
    ] satisfies Prisma.InspectionChecklistItemOrderByWithRelationInput[],
    include: {
      media: { orderBy: { createdAt: 'asc' as const } },
    },
  },
  requestItems: {
    orderBy: [
      { sortOrder: 'asc' as const },
      { createdAt: 'asc' as const },
    ] satisfies Prisma.InspectionRequestItemOrderByWithRelationInput[],
    include: {
      media: { orderBy: { createdAt: 'asc' as const } },
    },
  },
  errorCodes: {
    orderBy: [
      { sortOrder: 'asc' as const },
      { createdAt: 'asc' as const },
    ] satisfies Prisma.InspectionErrorCodeOrderByWithRelationInput[],
    include: {
      media: { orderBy: { createdAt: 'asc' as const } },
    },
  },
  sharedWith: { select: SHARED_USER_SELECT },
  buyer: { select: BUYER_BRIEF_SELECT },
} satisfies Prisma.VehicleInspectionInclude;

// Treat Sat/Sun as if they didn't exist when measuring lead time. Adding
// `hours` of "business" time means: every hour landing on a weekend is
// skipped and the same hour is consumed on the next Monday at the same
// time-of-day. Same result as iterating one hour at a time, but O(1).
function addBusinessHours(start: Date, hours: number): Date {
  let cur = new Date(start);
  // Snap a weekend start to next Monday (same time-of-day).
  const startDay = cur.getUTCDay();
  if (startDay === 6) cur = new Date(cur.getTime() + 2 * 86_400_000);
  else if (startDay === 0) cur = new Date(cur.getTime() + 1 * 86_400_000);

  let remainingMs = hours * 3_600_000;
  while (remainingMs > 0) {
    // ms left in the current weekday (until 24:00 UTC).
    const dayEnd = new Date(cur);
    dayEnd.setUTCHours(24, 0, 0, 0);
    const slice = dayEnd.getTime() - cur.getTime();
    if (slice > remainingMs) {
      cur = new Date(cur.getTime() + remainingMs);
      remainingMs = 0;
    } else {
      remainingMs -= slice;
      cur = dayEnd;
      // Skip Sat/Sun entirely.
      const d = cur.getUTCDay();
      if (d === 6) cur = new Date(cur.getTime() + 2 * 86_400_000);
      else if (d === 0) cur = new Date(cur.getTime() + 1 * 86_400_000);
    }
  }
  return cur;
}

function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

function serialize(row: any) {
  return {
    ...row,
    marketPrice: row.marketPrice?.toString() ?? null,
  };
}

@Injectable()
export class VehicleInspectionsService {
  private readonly logger = new Logger(VehicleInspectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── inspections ──────────────────────────────────────────────────

  async list(
    tenantId: string,
    userId: string | null,
    query: ListVehicleInspectionsDto,
  ) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = Math.min(query.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

    // Visibility: either the inspection belongs to the user's tenant, OR
    // the user has been explicitly added to its sharedWith list. The latter
    // is how clients (possibly from other tenants) get access.
    const visibility: Prisma.VehicleInspectionWhereInput[] = [];
    if (tenantId) visibility.push({ tenantId });
    if (userId) visibility.push({ sharedWith: { some: { id: userId } } });
    const where: Prisma.VehicleInspectionWhereInput = {
      ...(visibility.length === 1 ? visibility[0] : { OR: visibility }),
      ...(query.status && { status: query.status }),
      ...(query.buyerId && { buyerId: query.buyerId }),
      ...(query.vehicleId && { vehicleId: query.vehicleId }),
      ...(query.vin && { vin: query.vin }),
      ...(query.lotNumber && { lotNumber: query.lotNumber }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.vehicleInspection.findMany({
        where,
        orderBy: { requestedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { buyer: { select: BUYER_BRIEF_SELECT } },
      }),
      this.prisma.vehicleInspection.count({ where }),
    ]);

    return {
      data: rows.map(serialize),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async get(id: string, tenantId: string, userId: string | null) {
    const visibility: Prisma.VehicleInspectionWhereInput[] = [];
    if (tenantId) visibility.push({ tenantId });
    if (userId) visibility.push({ sharedWith: { some: { id: userId } } });
    const row = await this.prisma.vehicleInspection.findFirst({
      where: {
        id,
        ...(visibility.length === 1 ? visibility[0] : { OR: visibility }),
      },
      include: INSPECTION_INCLUDE,
    });
    if (!row) throw new NotFoundException(`Inspection ${id} not found`);
    return serialize(row);
  }

  async create(
    tenantId: string,
    userId: string | null,
    dto: CreateVehicleInspectionDto,
  ) {
    // Staff can override the yard on-site gate by acknowledging the warning.
    if (!dto.acknowledgeYardWarning) {
      await this.validateYardPhysicalInspection(dto);
    }
    // Staff path (dashboard): dueAt omitted → skip timing validation entirely.
    // Customer path (portal checkout): dueAt is never sent from the portal either,
    // but the 48-hour gate is enforced at checkout time in PortalService.checkoutInspections.
    if (dto.dueAt) await this.validateRequestedWindow(dto);

    const row = await this.prisma.vehicleInspection.create({
      data: {
        tenantId: tenantId || null,
        createdBy: userId,
        vin: dto.vin,
        lotNumber: dto.lotNumber,
        yardName: dto.yardName,
        yardNumber: dto.yardNumber,
        vehicleId: dto.vehicleId,
        buyerId: dto.buyerId,
        status: dto.status ?? 'REQUESTED',
        specificRequest: dto.specificRequest,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        inspectedAt: dto.inspectedAt ? new Date(dto.inspectedAt) : null,
        inspectorId: dto.inspectorId,
        overallRating: dto.overallRating,
        marketPrice:
          dto.marketPrice != null ? new Prisma.Decimal(dto.marketPrice) : null,
        notes: dto.notes,
        sharedWith: dto.sharedWithIds?.length
          ? { connect: dto.sharedWithIds.map((id) => ({ id })) }
          : undefined,
        // Auto-seed the default checklist so every inspector starts from the
        // same baseline. Items remain editable / deletable per inspection.
        checklist: {
          create: DEFAULT_CHECKLIST.map((it, idx) => ({
            category: it.category,
            part: it.part,
            sortOrder: idx,
          })),
        },
      },
      include: INSPECTION_INCLUDE,
    });

    // Hasta ahora solo avisaba el portal del cliente: una inspeccion creada
    // desde el dashboard no generaba nada y el equipo no se enteraba.
    this.notify(tenantId, 'CUSTOMER_INSPECTION_REQUESTED', 'Inspeccion solicitada', row);

    return serialize(row);
  }

  async update(id: string, tenantId: string, dto: UpdateVehicleInspectionDto) {
    const previo = await this.ensureInspection(id, tenantId);

    const data: Prisma.VehicleInspectionUpdateInput = {};
    if (dto.vin !== undefined) data.vin = dto.vin;
    if (dto.lotNumber !== undefined) data.lotNumber = dto.lotNumber;
    if (dto.yardName !== undefined) data.yardName = dto.yardName;
    if (dto.yardNumber !== undefined) data.yardNumber = dto.yardNumber;
    if (dto.vehicleId !== undefined)
      data.vehicle = dto.vehicleId
        ? { connect: { id: dto.vehicleId } }
        : { disconnect: true };
    if (dto.buyerId !== undefined)
      data.buyer = dto.buyerId
        ? { connect: { id: dto.buyerId } }
        : { disconnect: true };
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.specificRequest !== undefined)
      data.specificRequest = dto.specificRequest;
    if (dto.dueAt !== undefined)
      data.dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    if (dto.inspectedAt !== undefined)
      data.inspectedAt = dto.inspectedAt ? new Date(dto.inspectedAt) : null;
    if (dto.completedAt !== undefined)
      data.completedAt = dto.completedAt ? new Date(dto.completedAt) : null;
    if (dto.inspectorId !== undefined) data.inspectorId = dto.inspectorId;
    if (dto.overallRating !== undefined) data.overallRating = dto.overallRating;
    if (dto.marketPrice !== undefined)
      data.marketPrice =
        dto.marketPrice === null ? null : new Prisma.Decimal(dto.marketPrice);
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.sharedWithIds !== undefined)
      data.sharedWith = { set: dto.sharedWithIds.map((id) => ({ id })) };

    // Auto-stamp completedAt when moving to DONE for the first time.
    if (dto.status === 'DONE' && !data.completedAt) {
      data.completedAt = new Date();
    }

    const row = await this.prisma.vehicleInspection.update({
      where: { id },
      data,
      include: INSPECTION_INCLUDE,
    });

    // Solo cuando el estado cambia de verdad. Sin esta comparacion, guardar dos
    // veces la misma inspeccion mandaria el aviso dos veces.
    if (dto.status !== undefined && dto.status !== previo.status) {
      if (dto.status === 'CANCELED') {
        this.notify(tenantId, 'CUSTOMER_INSPECTION_CANCELLED', 'Inspeccion cancelada', row);
      } else if (dto.status === 'DONE') {
        this.notify(tenantId, 'CUSTOMER_INSPECTION_COMPLETED', 'Inspeccion completada', row);
      }
    }

    return serialize(row);
  }

  async remove(id: string, tenantId: string) {
    await this.ensureInspection(id, tenantId);
    // Se lee antes de borrar: despues no hay de donde sacar el lote ni el VIN.
    const previo = await this.prisma.vehicleInspection.findUnique({
      where: { id },
      select: { id: true, vin: true, lotNumber: true, yardName: true },
    });
    const keys = await this.collectInspectionStorageKeys([id]);
    await this.prisma.vehicleInspection.delete({ where: { id } });

    // Borrar era el unico camino sin aviso, y es justo el que usa la gente
    // para deshacer una inspeccion. Para el equipo el efecto es el mismo que
    // cancelarla: deja de haber inspeccion.
    if (previo) {
      this.notify(tenantId, 'CUSTOMER_INSPECTION_CANCELLED', 'Inspeccion eliminada', previo);
    }
    // S3 cleanup is best-effort and intentionally async: a missed key
    // costs cents in storage, but blocking the response on S3 retries
    // makes the UI feel broken when the API container has bad network.
    this.cleanupS3Keys(keys);
    return { deleted: true, mediaCleaned: keys.length };
  }

  /**
   * Delete multiple inspections in one call. Every id is validated against
   * the tenant before any delete happens — if any id doesn't belong to
   * this tenant we 404, so the caller can't half-delete.
   */
  async removeMany(
    ids: string[],
    tenantId: string,
  ): Promise<{ deleted: number; mediaCleaned: number }> {
    if (!ids.length) return { deleted: 0, mediaCleaned: 0 };
    // De-dup just in case.
    const uniqueIds = Array.from(new Set(ids));

    // Tenant-scoped existence check: must match every requested id.
    const found = await this.prisma.vehicleInspection.findMany({
      where: { id: { in: uniqueIds }, tenantId: tenantId || undefined },
      select: { id: true },
    });
    if (found.length !== uniqueIds.length) {
      throw new NotFoundException(
        'One or more inspections were not found for this tenant',
      );
    }

    const previas = await this.prisma.vehicleInspection.findMany({
      where: { id: { in: uniqueIds }, tenantId: tenantId || undefined },
      select: { id: true, vin: true, lotNumber: true, yardName: true },
    });

    const keys = await this.collectInspectionStorageKeys(uniqueIds);
    const result = await this.prisma.vehicleInspection.deleteMany({
      where: { id: { in: uniqueIds }, tenantId: tenantId || undefined },
    });
    this.cleanupS3Keys(keys);

    // Un aviso para todo el borrado: seleccionar veinte y borrarlas no son
    // veinte mensajes en el grupo.
    if (previas.length === 1) {
      this.notify(tenantId, 'CUSTOMER_INSPECTION_CANCELLED', 'Inspeccion eliminada', previas[0]);
    } else if (previas.length > 1) {
      this.notifyPlain(
        tenantId,
        'CUSTOMER_INSPECTION_CANCELLED',
        `${previas.length} inspecciones eliminadas`,
        previas
          .map((p) => `• ${p.lotNumber ? `Lote ${p.lotNumber}` : p.vin}`)
          .slice(0, 10)
          .join('\n'),
      );
    }

    return { deleted: result.count, mediaCleaned: keys.length };
  }

  /**
   * Gather every S3 storage key tied to a set of inspections — top-level
   * inspection media + per-checklist-item media + per-request-item media.
   * Carfax media is intentionally NOT touched (lives under its own model
   * and may be referenced elsewhere).
   */
  private async collectInspectionStorageKeys(
    inspectionIds: string[],
  ): Promise<string[]> {
    const rows = await this.prisma.media.findMany({
      where: {
        OR: [
          { inspectionId: { in: inspectionIds } },
          { inspectionChecklistItem: { inspectionId: { in: inspectionIds } } },
          { inspectionRequestItem: { inspectionId: { in: inspectionIds } } },
          { inspectionErrorCode: { inspectionId: { in: inspectionIds } } },
        ],
      },
      select: { storageKey: true },
    });
    return rows
      .map((r) => r.storageKey)
      .filter((k): k is string => !!k);
  }

  /**
   * Fire-and-forget S3 cleanup. Errors are logged but never propagated —
   * orphaned objects are recoverable (manual prefix sweep) but breaking
   * the delete response is not.
   */
  private cleanupS3Keys(keys: string[]): void {
    if (!keys.length) return;
    void Promise.allSettled(
      keys.map((key) => this.s3.deleteFile(key)),
    ).then((results) => {
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        this.logger.warn(
          `S3 cleanup: ${failed}/${keys.length} keys failed to delete`,
        );
      }
    });
  }

  // ─── checklist items ──────────────────────────────────────────────

  async addChecklistItem(
    inspectionId: string,
    tenantId: string,
    dto: CreateChecklistItemDto,
  ) {
    await this.ensureInspection(inspectionId, tenantId);
    return this.prisma.inspectionChecklistItem.create({
      data: {
        inspectionId,
        category: dto.category,
        part: dto.part,
        quality: dto.quality,
        notes: dto.notes,
        voiceNoteTranscription: dto.voiceNoteTranscription,
        sortOrder: dto.sortOrder ?? 0,
      },
      include: { media: true },
    });
  }

  async updateChecklistItem(
    itemId: string,
    inspectionId: string,
    tenantId: string,
    dto: UpdateChecklistItemDto,
  ) {
    await this.ensureChecklistItem(itemId, inspectionId, tenantId);

    const data: Prisma.InspectionChecklistItemUpdateInput = {};
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.part !== undefined) data.part = dto.part;
    if (dto.quality !== undefined) data.quality = dto.quality;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.voiceNoteTranscription !== undefined)
      data.voiceNoteTranscription = dto.voiceNoteTranscription;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;

    return this.prisma.inspectionChecklistItem.update({
      where: { id: itemId },
      data,
      include: { media: true },
    });
  }

  async removeChecklistItem(
    itemId: string,
    inspectionId: string,
    tenantId: string,
  ) {
    await this.ensureChecklistItem(itemId, inspectionId, tenantId);
    await this.prisma.inspectionChecklistItem.delete({ where: { id: itemId } });
    return { deleted: true };
  }

  // ─── client request items ─────────────────────────────────────────

  async addRequestItem(
    inspectionId: string,
    tenantId: string,
    dto: CreateRequestItemDto,
  ) {
    await this.ensureInspection(inspectionId, tenantId);
    return this.prisma.inspectionRequestItem.create({
      data: {
        inspectionId,
        note: dto.note,
        sortOrder: dto.sortOrder ?? 0,
      },
      include: { media: true },
    });
  }

  async updateRequestItem(
    itemId: string,
    inspectionId: string,
    tenantId: string,
    dto: UpdateRequestItemDto,
  ) {
    await this.ensureRequestItem(itemId, inspectionId, tenantId);
    const data: Prisma.InspectionRequestItemUpdateInput = {};
    if (dto.note !== undefined) data.note = dto.note;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    return this.prisma.inspectionRequestItem.update({
      where: { id: itemId },
      data,
      include: { media: true },
    });
  }

  async removeRequestItem(
    itemId: string,
    inspectionId: string,
    tenantId: string,
  ) {
    await this.ensureRequestItem(itemId, inspectionId, tenantId);
    await this.prisma.inspectionRequestItem.delete({ where: { id: itemId } });
    return { deleted: true };
  }

  // ─── inspection error codes ───────────────────────────────────────

  async addErrorCode(
    inspectionId: string,
    tenantId: string,
    dto: CreateInspectionErrorCodeDto,
  ) {
    await this.ensureInspection(inspectionId, tenantId);
    return this.prisma.inspectionErrorCode.create({
      data: {
        inspectionId,
        code: dto.code,
        description: dto.description,
        level: dto.level,
        note: dto.note,
        voiceNoteTranscription: dto.voiceNoteTranscription,
        sortOrder: dto.sortOrder ?? 0,
      },
      include: { media: { orderBy: { createdAt: 'asc' as const } } },
    });
  }

  async updateErrorCode(
    itemId: string,
    inspectionId: string,
    tenantId: string,
    dto: UpdateInspectionErrorCodeDto,
  ) {
    await this.ensureErrorCode(itemId, inspectionId, tenantId);

    const data: Prisma.InspectionErrorCodeUpdateInput = {};
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.level !== undefined) data.level = dto.level;
    if (dto.note !== undefined) data.note = dto.note;
    if (dto.voiceNoteTranscription !== undefined)
      data.voiceNoteTranscription = dto.voiceNoteTranscription;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;

    return this.prisma.inspectionErrorCode.update({
      where: { id: itemId },
      data,
      include: { media: { orderBy: { createdAt: 'asc' as const } } },
    });
  }

  async removeErrorCode(
    itemId: string,
    inspectionId: string,
    tenantId: string,
  ) {
    await this.ensureErrorCode(itemId, inspectionId, tenantId);
    await this.prisma.inspectionErrorCode.delete({ where: { id: itemId } });
    return { deleted: true };
  }

  // ─── helpers ──────────────────────────────────────────────────────

  /**
   * Enforce: the inspection's yard must support on-site (physical)
   * inspection. Resolves the yard through the auction listing (preferred,
   * because the listing has been linked by the trigger) and falls back to
   * the inspection's own yardNumber when the listing isn't in our DB.
   *
   * Throws BadRequestException when:
   * - The yard is known and has physicalInspectionAvailable = false.
   * - A lotNumber / yardNumber was provided but no matching yard exists
   *   (we can't promise on-site coverage for a yard we don't have on file).
   *
   * Returns silently when no yard reference is available at all — that
   * covers manual inspections for vehicles outside the auction pipeline.
   */
  private async validateYardPhysicalInspection(
    dto: CreateVehicleInspectionDto,
  ): Promise<void> {
    // Try the listing → yard chain first.
    let yard: { physicalInspectionAvailable: boolean; name: string } | null =
      null;

    if (dto.lotNumber) {
      let lotKey: bigint | null = null;
      try {
        lotKey = BigInt(dto.lotNumber);
      } catch {
        lotKey = null;
      }
      if (lotKey !== null) {
        const listing = await this.prisma.auctionListing.findUnique({
          where: { lotNumber: lotKey },
          select: {
            yardNumber: true,
            yard: {
              select: { physicalInspectionAvailable: true, name: true },
            },
          },
        });
        if (listing?.yard) {
          yard = listing.yard;
        } else if (listing?.yardNumber != null) {
          // Listing exists but yardId wasn't filled (very unusual since
          // the trigger fills it on insert/update). Do the join ourselves.
          yard = await this.prisma.yard.findUnique({
            where: {
              source_yardNumber: {
                source: 'COPART',
                yardNumber: listing.yardNumber,
              },
            },
            select: { physicalInspectionAvailable: true, name: true },
          });
        }
      }
    }

    // Last-resort lookup directly by the inspection's own yardNumber.
    if (!yard && dto.yardNumber) {
      const yardNumberInt = parseInt(dto.yardNumber, 10);
      if (Number.isFinite(yardNumberInt)) {
        yard = await this.prisma.yard.findUnique({
          where: {
            source_yardNumber: { source: 'COPART', yardNumber: yardNumberInt },
          },
          select: { physicalInspectionAvailable: true, name: true },
        });
      }
    }

    // No yard ref at all — manual / non-auction inspection, allow.
    if (!yard && !dto.lotNumber && !dto.yardNumber) return;

    if (!yard) {
      throw new BadRequestException(
        "This vehicle's yard is not in our system. Add the yard from Settings → Yards (with the physical-inspection flag) before creating an inspection.",
      );
    }

    if (!yard.physicalInspectionAvailable) {
      throw new BadRequestException(
        `Inspection cannot be created: ${yard.name} does not offer on-site inspection. Mark the yard as physical-inspection-available from Settings → Yards if this is wrong.`,
      );
    }
  }

  // Enforce: dueAt must (a) fall on a weekday — Copart closed Sat/Sun —
  // (b) be at least 48 *business* hours from now (weekend hours don't count),
  // and (c) be strictly before the scheduled auction datetime when the
  // listing has one. Future-sale lots (no saleDate) have no upper bound.
  private async validateRequestedWindow(
    dto: CreateVehicleInspectionDto,
  ): Promise<void> {
    if (!dto.dueAt) return;
    const due = new Date(dto.dueAt);
    if (Number.isNaN(due.getTime())) {
      throw new BadRequestException('dueAt is not a valid date');
    }

    if (isWeekend(due)) {
      throw new BadRequestException(
        'Deadline must be a weekday — Copart is closed Sat/Sun',
      );
    }

    const now = new Date();
    const earliest = addBusinessHours(now, MIN_LEAD_HOURS);
    if (due < earliest) {
      throw new BadRequestException(
        `Requested date must be at least ${MIN_LEAD_HOURS} business hours from now (weekends excluded)`,
      );
    }

    if (!dto.lotNumber) return;
    let lotKey: bigint;
    try {
      lotKey = BigInt(dto.lotNumber);
    } catch {
      return;
    }
    const listing = await this.prisma.auctionListing.findUnique({
      where: { lotNumber: lotKey },
      select: { saleDate: true, saleTime: true },
    });
    if (!listing) return;
    const auctionAt = parseAuctionDateTime(listing.saleDate, listing.saleTime);
    if (auctionAt && due >= auctionAt) {
      throw new BadRequestException(
        'Requested date must be before the scheduled auction date',
      );
    }
  }

  /**
   * Devuelve el estado actual ademas de comprobar que existe: `update` lo
   * necesita para saber si el estado cambio de verdad y no avisar dos veces
   * cuando alguien guarda la misma inspeccion sin tocarlo.
   */
  private async ensureInspection(
    id: string,
    tenantId: string,
  ): Promise<{ id: string; status: VehicleInspectionStatus }> {
    const exists = await this.prisma.vehicleInspection.findFirst({
      where: { id, tenantId: tenantId || undefined },
      select: { id: true, status: true },
    });
    if (!exists) throw new NotFoundException(`Inspection ${id} not found`);
    return exists;
  }

  // ── Avisos al equipo ──────────────────────────────────────────────────────

  /**
   * Ficha del vehiculo para el cuerpo del aviso.
   *
   * "Lote 52873876" no le dice nada a nadie leyendo el movil. La inspeccion
   * guarda VIN, lote y yard, pero no marca ni modelo: eso vive en
   * `auction_listings`, asi que se busca por lote (que es su clave primaria) y
   * si no hay, por VIN.
   *
   * La consulta es best-effort: si el lote ya no esta en el feed, el aviso sale
   * igual con lo que tenemos.
   */
  private async vehicleLines(row: {
    vin?: string | null;
    lotNumber?: string | null;
    yardName?: string | null;
  }): Promise<string> {
    let listing: {
      year: number | null;
      make: string | null;
      modelGroup: string | null;
      modelDetail: string | null;
      vin: string | null;
    } | null = null;

    try {
      const select = {
        year: true,
        make: true,
        modelGroup: true,
        modelDetail: true,
        vin: true,
      };
      // El lote es la clave primaria, asi que es la busqueda barata.
      const lote = row.lotNumber ? this.toBigInt(row.lotNumber) : null;
      if (lote !== null) {
        listing = await this.prisma.auctionListing.findUnique({
          where: { lotNumber: lote },
          select,
        });
      }
      if (!listing && row.vin) {
        listing = await this.prisma.auctionListing.findFirst({
          where: { vin: row.vin },
          select,
        });
      }
    } catch {
      // Un aviso sin marca y modelo sigue siendo util; uno que no sale, no.
    }

    const descripcion = [
      listing?.year,
      listing?.make,
      listing?.modelGroup,
      listing?.modelDetail,
    ]
      .filter(Boolean)
      .join(' ');

    const lineas: string[] = [];
    if (descripcion) lineas.push(descripcion.toUpperCase());
    const vin = row.vin || listing?.vin;
    if (vin) lineas.push(`VIN ${vin}`);

    const ubicacion = [
      row.lotNumber ? `Lote ${row.lotNumber}` : null,
      row.yardName,
    ]
      .filter(Boolean)
      .join(' · ');
    if (ubicacion) lineas.push(ubicacion);

    return lineas.join('\n') || 'sin identificar';
  }

  /**
   * Aviso con cuerpo ya construido, sin consultar el listing.
   *
   * Lo usa el borrado multiple: ahi el cuerpo es la lista de lo borrado, y
   * pedir la ficha de cada coche serian N consultas para un mensaje que de
   * todas formas se corta a diez lineas.
   */
  private notifyPlain(
    tenantId: string,
    type: string,
    title: string,
    message: string,
  ): void {
    if (!tenantId) return;
    void this.notifications
      .notifyTenantStaff(tenantId, {
        title,
        message,
        type,
        entityType: 'VehicleInspection',
        actionUrl: '/dashboard/inspection',
        priority: 'normal',
      })
      .catch(() => undefined);
  }

  /** El lote es BigInt en `auction_listings` y texto en la inspeccion. */
  private toBigInt(v: string): bigint | null {
    const limpio = v.replace(/\D/g, '');
    if (!limpio) return null;
    try {
      return BigInt(limpio);
    } catch {
      return null;
    }
  }

  /**
   * Avisa al equipo. Best-effort por partida doble: `notifyTenantStaff` ya no
   * lanza, y ademas se ignora cualquier error aqui — una inspeccion nunca debe
   * fallar porque el aviso no saliera.
   */
  private notify(
    tenantId: string,
    type: string,
    title: string,
    row: { id: string; vin?: string | null; lotNumber?: string | null; yardName?: string | null },
  ): void {
    if (!tenantId) return; // sin tenant no hay a quien avisar
    const inspectionId = row.id;
    void this.vehicleLines(row)
      .then((message) =>
        this.notifications.notifyTenantStaff(tenantId, {
          title,
          message,
          type,
          entityType: 'VehicleInspection',
          entityId: inspectionId,
          actionUrl: `/dashboard/inspections/${inspectionId}`,
          priority: 'normal',
        }),
      )
      .catch(() => undefined);
  }

  private async ensureChecklistItem(
    itemId: string,
    inspectionId: string,
    tenantId: string,
  ): Promise<void> {
    const exists = await this.prisma.inspectionChecklistItem.findFirst({
      where: {
        id: itemId,
        inspectionId,
        inspection: { tenantId: tenantId || undefined },
      },
      select: { id: true },
    });
    if (!exists)
      throw new NotFoundException(`Checklist item ${itemId} not found`);
  }

  private async ensureRequestItem(
    itemId: string,
    inspectionId: string,
    tenantId: string,
  ): Promise<void> {
    const exists = await this.prisma.inspectionRequestItem.findFirst({
      where: {
        id: itemId,
        inspectionId,
        inspection: { tenantId: tenantId || undefined },
      },
      select: { id: true },
    });
    if (!exists)
      throw new NotFoundException(`Request item ${itemId} not found`);
  }

  private async ensureErrorCode(
    itemId: string,
    inspectionId: string,
    tenantId: string,
  ): Promise<void> {
    const exists = await this.prisma.inspectionErrorCode.findFirst({
      where: {
        id: itemId,
        inspectionId,
        inspection: { tenantId: tenantId || undefined },
      },
      select: { id: true },
    });
    if (!exists)
      throw new NotFoundException(`Error code ${itemId} not found`);
  }
}
