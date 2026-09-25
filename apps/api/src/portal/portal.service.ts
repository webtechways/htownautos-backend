import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import Stripe from 'stripe';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { S3Service } from '@htownautos/common';
import type { PortalBuyer } from '@htownautos/auth';
import { PORTAL_TENANT_ID, ensureUserForBuyer } from '@htownautos/auth';
import { RabbitMQService, CLERK_PUSH_QUEUE } from '@htownautos/rabbitmq';
import { CopartService } from '../copart/copart.service';
import { QueryCopartDto } from '../copart/dto/query-copart.dto';
import { AuctionSearchService } from '../opensearch/auction-search.service';
import { VehicleInspectionsService } from '../vehicle-inspections/vehicle-inspections.service';
import { UpdatePortalProfileDto } from './dto/update-portal-profile.dto';
import { CreateDepositDto } from './dto/create-deposit.dto';
import { InspectionCartDto, CartItemDto } from './dto/inspection-cart.dto';
import { PortalPricingService, PortalPricing } from './portal-pricing.service';
import { FindACarCheckoutDto } from './dto/find-a-car-checkout.dto';
import { AuctionAnalysisService } from '../auction-analysis/auction-analysis.service';
import { NotificationsService } from '../notifications/notifications.service';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Minimum deposit amount in cents ($10). */
const MIN_DEPOSIT_CENTS = 1000;

/** Fixed price for the "Find a Car for Me" service in cents ($500). */
const FIND_A_CAR_PRICE_CENTS = 50_000;

/**
 * Minimum business-hour lead time before auction start that we require to
 * accept an inspection order. Mirrors the same constant in VehicleInspectionsService.
 */
const PORTAL_MIN_LEAD_HOURS = 48;

// ── Business-hours helpers (portal copy — same logic as vehicle-inspections.service) ──

/** Parse Copart-style saleDate (YYYYMMDD as int) + saleTime ("HH:mm") into UTC. */
function parsePortalAuctionDateTime(
  saleDate: number | null | undefined,
  saleTime: string | null | undefined,
): Date | null {
  if (!saleDate || saleDate === 0) return null;
  const str = saleDate.toString();
  if (str.length !== 8) return null;
  const year = Number(str.slice(0, 4));
  const month = Number(str.slice(4, 6)) - 1;
  const day = Number(str.slice(6, 8));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  let hours = 0;
  let minutes = 0;
  if (saleTime) {
    const m = saleTime.match(/^(\d{1,2}):(\d{2})/);
    if (m) { hours = Number(m[1]); minutes = Number(m[2]); }
  }
  return new Date(Date.UTC(year, month, day, hours, minutes));
}

/**
 * Add `hours` of "business" time (Mon-Fri only) to `start`.
 * Weekend hours are skipped entirely — same algorithm as VehicleInspectionsService.
 */
function addPortalBusinessHours(start: Date, hours: number): Date {
  let cur = new Date(start);
  const startDay = cur.getUTCDay();
  if (startDay === 6) cur = new Date(cur.getTime() + 2 * 86_400_000);
  else if (startDay === 0) cur = new Date(cur.getTime() + 1 * 86_400_000);

  let remainingMs = hours * 3_600_000;
  while (remainingMs > 0) {
    const dayEnd = new Date(cur);
    dayEnd.setUTCHours(24, 0, 0, 0);
    const slice = dayEnd.getTime() - cur.getTime();
    if (slice > remainingMs) {
      cur = new Date(cur.getTime() + remainingMs);
      remainingMs = 0;
    } else {
      remainingMs -= slice;
      cur = dayEnd;
      const d = cur.getUTCDay();
      if (d === 6) cur = new Date(cur.getTime() + 2 * 86_400_000);
      else if (d === 0) cur = new Date(cur.getTime() + 1 * 86_400_000);
    }
  }
  return cur;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Safe Buyer fields returned to portal customers. */
const BUYER_SAFE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phoneMain: true,
  phoneMobile: true,
  phoneSecondary: true,
  currentAddress: true,
  currentCity: true,
  currentState: true,
  currentZipCode: true,
  currentCountry: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.BuyerSelect;

/** Per-yard group used for breakdown computation. */
interface YardGroup {
  yardId: string;
  yardName: string | undefined;
  cars: CartItemDto[];
}

/** Resolved yard fee data from the DB. */
interface YardFeeData {
  travelFeeCents: number;
  minCars: number;
  name: string;
}

/** Full quote breakdown. */
export interface InspectionQuote {
  items: CartItemDto[];
  byYard: Array<{
    yardId: string;
    yardName?: string;
    cars: number;
    travelFeeCents: number;
    minCars: number;
  }>;
  carsCount: number;
  yardsCount: number;
  inspectionFeeCents: number;
  travelFeeCents: number;
  inspectionSubtotalCents: number;
  travelSubtotalCents: number;
  totalCents: number;
  currency: 'usd';
  /** Present only when checkout=true and a yard fails minCars; empty array at quote time. */
  minCarsViolations: Array<{ yardId: string; yardName: string; required: number; actual: number }>;
}

/**
 * Enriched, itemized receipt for a PortalOrder. Shared contract consumed by:
 *  - the web payment-success receipt (confirmOrderBySession)
 *  - the dashboard customer transactions view (StripeService.listPayments)
 * Returns null for non-INSPECTION orders (deposits have no per-car breakdown).
 */
export interface OrderReceiptDetail {
  id: string;
  type: 'INSPECTION' | 'DEPOSIT' | 'SERVICE';
  receiptNumber: string;
  status: string;
  description: string | null;
  totalCents: number;
  carsCount: number;
  yardsCount: number;
  inspectionSubtotalCents: number;
  travelSubtotalCents: number;
  inspectionFeeCents: number;
  byYard: Array<{
    yardId: string;
    yardName: string | null;
    location: { city: string | null; state: string | null } | null;
    cars: number;
    inspectionFeeCents: number;
    inspectionSubtotalCents: number;
    travelFeeCents: number;
    vehicles: Array<{
      inspectionId: string | null;
      lotNumber: string | null;
      vin: string | null;
      year: number | null;
      make: string | null;
      model: string | null;
    }>;
  }>;
  inspections: Array<{
    id: string;
    vin: string | null;
    lotNumber: string | null;
    year: number | null;
    make: string | null;
    model: string | null;
    yardName: string | null;
  }>;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class PortalService {
  private readonly logger = new Logger(PortalService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly copartService: CopartService,
    private readonly inspectionsService: VehicleInspectionsService,
    private readonly pricingService: PortalPricingService,
    private readonly auctionSearchService: AuctionSearchService,
    private readonly s3: S3Service,
    private readonly auctionAnalysis: AuctionAnalysisService,
    private readonly notifications: NotificationsService,
    private readonly rabbitMQ: RabbitMQService,
  ) {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  }

  // ── Profile ───────────────────────────────────────────────────────────────

  async getProfile(buyer: PortalBuyer) {
    // Re-read from DB to ensure freshest data, scoped to buyer + tenant.
    const row = await this.prisma.buyer.findFirst({
      where: { id: buyer.id, tenantId: buyer.tenantId },
      select: BUYER_SAFE_SELECT,
    });
    if (!row) throw new NotFoundException('Buyer profile not found');
    return row;
  }

  async updateProfile(buyer: PortalBuyer, dto: UpdatePortalProfileDto) {
    const data: Prisma.BuyerUpdateInput = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.phoneMain !== undefined) data.phoneMain = dto.phoneMain;
    if (dto.phoneMobile !== undefined) data.phoneMobile = dto.phoneMobile;
    if (dto.phoneSecondary !== undefined)
      data.phoneSecondary = dto.phoneSecondary;

    const updated = await this.prisma.buyer.update({
      where: { id: buyer.id },
      data,
      select: BUYER_SAFE_SELECT,
    });

    // Identity sync (CLERK-SYNC-DESIGN.md, package B2) — a customer editing
    // their own name/phone is a legitimate "last writer" event; phone is the
    // login identifier (email code + SMS code), so it must reach Clerk.
    // Best-effort, never blocks the portal request.
    const { userId, shouldPublish } = await ensureUserForBuyer(this.prisma, {
      buyerId: buyer.id,
      tenantId: buyer.tenantId,
      email: updated.email,
      phoneMain: updated.phoneMain,
      firstName: updated.firstName,
      lastName: updated.lastName,
    });
    if (shouldPublish && userId) {
      await this.rabbitMQ.publish(CLERK_PUSH_QUEUE, { userId });
    }

    return updated;
  }

  // ── Listings (proxy to CopartService) ────────────────────────────────────

  async getListings(query: QueryCopartDto) {
    // The public website only lists vehicles in yards that offer physical
    // inspection — force it regardless of what the client sends.
    return this.copartService.findAll({ ...query, inspectableOnly: true });
  }

  async getListingByLotNumber(lotNumber: string) {
    const listing = await this.copartService.findByLotNumber(lotNumber);
    if (!listing) {
      throw new NotFoundException(
        `Listing with lot number ${lotNumber} not found`,
      );
    }

    // Attach any Carfax report (with AI summary + a signed PDF URL) so the
    // public detail view can surface it. Lean shape — never leak the S3 key.
    const reports = await this.fetchAndSignCarfax(
      (listing as { vin?: string | null }).vin ?? '',
      lotNumber,
    );
    const carfax = reports.map((r: any) => ({
      id: r.id,
      aiSummary: r.aiSummary ?? null,
      analysis: r.analysis ?? null,
      signedUrl: r.signedUrl ?? null,
      date: r.date ?? null,
      createdAt: r.createdAt ?? null,
    }));

    return { ...listing, carfax };
  }

  /**
   * Returns distinct filter option lists from the auction_listings table.
   * Used to populate public-facing dropdowns (makes, years, damage types, etc.).
   * @deprecated Use getPortalFilters() for the faceted cascading endpoint.
   */
  getFilters() {
    return this.copartService.getFilterOptions();
  }

  /**
   * Faceted, cascading filter options for the customer portal.
   * Delegates to CopartService so no business logic lives in the service layer here.
   */
  getPortalFilters(opts: { year?: number; make?: string; model?: string; trim?: string }) {
    return this.copartService.getPortalFilters(opts);
  }

  /**
   * Returns the full image gallery for a lot.
   * Reads galleryCache from Postgres (TTL 30d); on miss, fetches from Copart
   * via ProxyService and queues a background cache write.
   * Returns { lotNumber, imageCount: 0, images: [] } for unknown lots.
   */
  async getListingGallery(lotNumber: string) {
    try {
      return await this.auctionSearchService.getCopartGallery(lotNumber);
    } catch (err) {
      // NotFoundException means the lot doesn't exist in our DB — return empty gallery.
      if ((err as any)?.status === 404 || err?.constructor?.name === 'NotFoundException') {
        return { lotNumber, imageCount: 0, images: [] };
      }
      throw err;
    }
  }

  // ── Pricing ───────────────────────────────────────────────────────────────

  /**
   * Returns the pricing configuration for the buyer's tenant.
   * Exposed to customers so the cart can display fees before checkout.
   */
  getPricingForBuyer(buyer: PortalBuyer) {
    return this.pricingService.getPricing(buyer.tenantId);
  }

  // ── Inspections ───────────────────────────────────────────────────────────

  async getInspections(buyer: PortalBuyer) {
    return this.inspectionsService.list(
      buyer.tenantId,
      null,
      { buyerId: buyer.id } as any,
    );
  }

  async getInspection(id: string, buyer: PortalBuyer) {
    // get() already enforces tenantId; we additionally verify buyerId.
    const inspection = await this.inspectionsService.get(
      id,
      buyer.tenantId,
      null,
    );
    if ((inspection as any).buyerId !== buyer.id) {
      throw new NotFoundException(`Inspection ${id} not found`);
    }
    await this.signInspectionMedia(inspection);

    // Fetch and attach Carfax reports — same shape the dashboard expects.
    const carfax = await this.fetchAndSignCarfax(
      (inspection as any).vin,
      (inspection as any).lotNumber,
    );

    // Attach all auction-analysis blocks (damages, parts, maxBid, snapshots).
    // Best-effort: null values mean "Pending" — never throws.
    const analysis = await this.auctionAnalysis.gatherForLot(
      (inspection as any).lotNumber ?? null,
    );

    return { ...inspection, carfax, analysis };
  }

  /**
   * Pre-sign every media URL (6h TTL) so the website can render the photos/
   * videos directly — mirrors the public share-link view. Best-effort: a
   * broken storageKey just won't display.
   */
  private async signInspectionMedia(inspection: any): Promise<void> {
    const MEDIA_SIGNED_URL_TTL = 60 * 60 * 6;
    const allMedia: { storageKey?: string | null; url?: string }[] = [
      ...(inspection.media ?? []),
      ...((inspection.checklist ?? []).flatMap((c: any) => c.media ?? [])),
      ...((inspection.requestItems ?? []).flatMap((r: any) => r.media ?? [])),
      ...((inspection.errorCodes ?? []).flatMap((e: any) => e.media ?? [])),
    ];
    await Promise.all(
      allMedia.map(async (m) => {
        if (!m.storageKey) return;
        try {
          m.url = await this.s3.getSignedUrl(m.storageKey, MEDIA_SIGNED_URL_TTL);
        } catch {
          /* swallow — broken keys just don't display */
        }
      }),
    );
  }

  /**
   * Fetch Carfax reports for a vehicle (by VIN and optionally lot number) and
   * pre-sign any S3-stored PDF keys. Reuses the same query logic as
   * InspectionShareLinksService.fetchCarfaxForVehicle (kept private there, so
   * we duplicate the minimal query here rather than exposing an internal method).
   */
  private async fetchAndSignCarfax(
    vin: string,
    lotNumber: string | null,
  ): Promise<any[]> {
    const CARFAX_SIGNED_URL_TTL = 60 * 60 * 6;
    const orClauses: Prisma.CarfaxReportWhereInput[] = [{ vin }];
    if (lotNumber) {
      try {
        orClauses.push({ auctionListingId: BigInt(lotNumber) });
      } catch {
        /* non-numeric lot */
      }
    }
    const reports = await this.prisma.carfaxReport.findMany({
      where: { OR: orClauses },
      orderBy: { createdAt: 'desc' },
    });
    await Promise.all(
      reports.map(async (r: any) => {
        if (!r.s3Key) return;
        try {
          // Carfax files can be HTML (CheapCarfax) or PDF (manual upload).
          // Serve with the right content-type + inline so it renders in an
          // embedded <iframe> instead of downloading or failing to parse.
          const isHtml = /\.html?$/i.test(r.s3Key);
          r.signedUrl = await this.s3.getSignedUrl(r.s3Key, CARFAX_SIGNED_URL_TTL, {
            contentType: isHtml ? 'text/html' : 'application/pdf',
            disposition: 'inline',
          });
        } catch {
          /* swallow */
        }
      }),
    );
    return reports;
  }

  // ── Special requests ──────────────────────────────────────────────────────

  /**
   * Customer adds a special request note to an inspection that is still
   * in REQUESTED status. Creates an InspectionRequestItem using the same
   * model the staff dashboard uses.
   *
   * Validates:
   *  1. The inspection belongs to the calling buyer (403/404 otherwise).
   *  2. The inspection status === 'REQUESTED' (400 otherwise).
   */
  async addInspectionRequest(
    id: string,
    buyer: PortalBuyer,
    text: string,
  ) {
    // Fetch lean fields only — avoid a heavy include on this write path.
    const inspection = await this.prisma.vehicleInspection.findFirst({
      where: { id, tenantId: buyer.tenantId },
      select: { id: true, buyerId: true, status: true },
    });

    if (!inspection || inspection.buyerId !== buyer.id) {
      throw new NotFoundException(`Inspection ${id} not found`);
    }

    if (inspection.status !== 'REQUESTED') {
      throw new BadRequestException(
        'Solo puedes agregar solicitudes mientras la inspección está en estado solicitada',
      );
    }

    const requestItem = await this.prisma.inspectionRequestItem.create({
      data: {
        inspectionId: id,
        note: text,
        sortOrder: 0,
      },
      include: { media: true },
    });

    // ── Notify staff ──────────────────────────────────────────────────────────
    try {
      const buyerName = `${buyer.firstName} ${buyer.lastName}`.trim();
      await this.notifications.notifyTenantStaff(buyer.tenantId, {
        title: 'Solicitud especial en inspección',
        message: `${buyerName} agregó una solicitud a una inspección`,
        type: 'CUSTOMER_INSPECTION_NOTE',
        entityType: 'VehicleInspection',
        entityId: id,
        actionUrl: `${this.dashboardBaseUrl()}/inspections/${id}`,
        metaValue: {
          buyerId: buyer.id,
          buyerName,
          inspectionId: id,
          note: text,
        } as Record<string, unknown>,
      });
    } catch {
      // best-effort: never throw
    }

    return requestItem;
  }

  // ── Cancel inspection (customer-initiated) ────────────────────────────────

  /**
   * Customer cancels one of their inspections.
   *
   * Rules:
   *  1. The inspection must belong to the calling buyer AND the buyer's tenant.
   *  2. Cannot cancel an already CANCELED or DONE/REJECTED inspection.
   *
   * Sets status=CANCELED, cancelledAt, cancelReason, cancelledByCustomer=true.
   * Returns the updated VehicleInspection.
   */
  async cancelInspection(
    id: string,
    buyer: PortalBuyer,
    reason?: string,
  ) {
    const inspection = await this.prisma.vehicleInspection.findFirst({
      where: { id, tenantId: buyer.tenantId },
      select: { id: true, buyerId: true, status: true },
    });

    if (!inspection || inspection.buyerId !== buyer.id) {
      throw new NotFoundException(`Inspection ${id} not found`);
    }

    const nonCancellableStatuses = ['CANCELED', 'DONE', 'REJECTED'];
    if (nonCancellableStatuses.includes(inspection.status as string)) {
      throw new BadRequestException(
        `No puedes cancelar una inspección en estado ${inspection.status}`,
      );
    }

    const updated = await this.prisma.vehicleInspection.update({
      where: { id },
      data: {
        status: 'CANCELED',
        cancelledAt: new Date(),
        cancelReason: reason ?? null,
        cancelledByCustomer: true,
      },
    });

    // ── Notify staff ──────────────────────────────────────────────────────────
    try {
      const buyerName = `${buyer.firstName} ${buyer.lastName}`.trim();
      await this.notifications.notifyTenantStaff(buyer.tenantId, {
        title: 'Inspección cancelada por cliente',
        message: `${buyerName} canceló una inspección`,
        type: 'CUSTOMER_INSPECTION_CANCELLED',
        entityType: 'VehicleInspection',
        entityId: id,
        actionUrl: `${this.dashboardBaseUrl()}/inspections/${id}`,
        metaValue: {
          buyerId: buyer.id,
          buyerName,
          inspectionId: id,
          reason: reason ?? null,
        } as Record<string, unknown>,
      });
    } catch {
      // best-effort: never throw
    }

    return updated;
  }

  // ── Order receipt + payment confirmation ───────────────────────────────────

  /**
   * Confirm a checkout by Stripe session id and return receipt data.
   * Acts as a FALLBACK to the webhook: if the order is still PENDING but Stripe
   * says the session is paid, fulfil it here (idempotent) so the inspections /
   * deposit get created even when the webhook didn't deliver.
   */
  async confirmOrderBySession(buyer: PortalBuyer, sessionId: string) {
    const order = await this.prisma.portalOrder.findFirst({
      where: { stripeCheckoutSessionId: sessionId, buyerId: buyer.id },
    });
    if (!order) throw new NotFoundException('Order not found');

    if (order.status === 'PENDING') {
      try {
        const session =
          await this.stripe.checkout.sessions.retrieve(sessionId);
        if (session.payment_status === 'paid') {
          await this.fulfillPortalOrder(session);
        }
      } catch (err) {
        this.logger.warn(
          `confirmOrderBySession ${sessionId}: ${(err as any)?.message}`,
        );
      }
    }

    const fresh =
      (await this.prisma.portalOrder.findUnique({
        where: { id: order.id },
      })) ?? order;
    const meta: any = fresh.metadata ?? {};
    const breakdown = await this.buildOrderReceiptDetail(fresh as any);
    return {
      orderId: fresh.id,
      receiptNumber: fresh.id.slice(0, 8).toUpperCase(),
      type: fresh.type,
      status: fresh.status,
      amountCents: Math.round(Number(fresh.amount) * 100),
      currency: fresh.currency,
      description: fresh.description,
      items: meta.items ?? [],
      breakdown,
      createdAt: fresh.createdAt,
    };
  }

  /**
   * Build an enriched, itemized receipt from a PortalOrder. Reused by the web
   * receipt and the dashboard transactions view. Returns null for non-INSPECTION
   * orders. Best-effort: any DB miss degrades to nulls, never throws — this runs
   * on read paths only.
   */
  async buildOrderReceiptDetail(order: {
    id: string;
    type: string;
    status: string;
    description: string | null;
    amount: Prisma.Decimal | number | string;
    tenantId: string | null;
    metadata: unknown;
  }): Promise<OrderReceiptDetail | null> {
    if (order.type !== 'INSPECTION') return null;

    try {
      const DEFAULT_TRAVEL_FEE = 5000;
      const meta = (order.metadata ?? {}) as Record<string, any>;
      const items: CartItemDto[] = Array.isArray(meta.items) ? meta.items : [];
      if (items.length === 0) return null;

      // Per-yard travel fees stored on the order at checkout time.
      const quoteByYard: Array<{ yardId: string; travelFeeCents?: number }> =
        Array.isArray(meta.quote?.byYard) ? meta.quote.byYard : [];
      const travelByYard = new Map<string, number>();
      for (const y of quoteByYard) {
        if (y?.yardId != null) travelByYard.set(String(y.yardId), y.travelFeeCents ?? DEFAULT_TRAVEL_FEE);
      }

      // Inspection fee per car (price the customer actually paid).
      let inspectionFeeCents: number | undefined = meta.pricing?.inspectionFeeCents;
      if (typeof inspectionFeeCents !== 'number') {
        const pricing = await this.pricingService
          .getPricing(order.tenantId ?? PORTAL_TENANT_ID)
          .catch(() => null);
        inspectionFeeCents = pricing?.inspectionFeeCents ?? 0;
      }

      // ── Resolve yard locations ──────────────────────────────────────────
      const yardIds = Array.from(new Set(items.map((i) => i.yardId).filter(Boolean)));
      const yardRows = yardIds.length
        ? await this.prisma.yard.findMany({
            where: { id: { in: yardIds } },
            select: { id: true, name: true, city: true, state: true, travelFeeCents: true },
          })
        : [];
      const yardMap = new Map(yardRows.map((y) => [y.id, y]));

      // ── Resolve vehicle year/make/model from auction listings ───────────
      const lotBigints: bigint[] = [];
      for (const i of items) {
        if (!i.lotNumber) continue;
        try {
          lotBigints.push(BigInt(i.lotNumber));
        } catch {
          /* non-numeric lot — skip */
        }
      }
      const listings = lotBigints.length
        ? await this.prisma.auctionListing.findMany({
            where: { lotNumber: { in: lotBigints } },
            select: { lotNumber: true, vin: true, year: true, make: true, modelGroup: true, modelDetail: true },
          })
        : [];
      const composeModel = (mg: string | null, md: string | null) =>
        [mg, md].filter(Boolean).join(' ') || null;
      const byLot = new Map<string, { year: number | null; make: string | null; model: string | null; vin: string | null }>();
      const byVin = new Map<string, { year: number | null; make: string | null; model: string | null }>();
      for (const l of listings) {
        const model = composeModel(l.modelGroup, l.modelDetail);
        byLot.set(l.lotNumber.toString(), { year: l.year, make: l.make, model, vin: l.vin });
        if (l.vin) byVin.set(l.vin, { year: l.year, make: l.make, model });
      }

      // ── Link created inspections (id by lot/vin) ────────────────────────
      const fulfilledIds: string[] = Array.isArray(meta.fulfilledInspectionIds)
        ? meta.fulfilledInspectionIds
        : [];
      const inspectionRows = fulfilledIds.length
        ? await this.prisma.vehicleInspection.findMany({
            where: { id: { in: fulfilledIds } },
            select: { id: true, vin: true, lotNumber: true, yardName: true },
          })
        : [];
      const inspByLot = new Map<string, { id: string; yardName: string | null }>();
      const inspByVin = new Map<string, { id: string; yardName: string | null }>();
      for (const r of inspectionRows) {
        if (r.lotNumber) inspByLot.set(r.lotNumber, { id: r.id, yardName: r.yardName });
        if (r.vin) inspByVin.set(r.vin, { id: r.id, yardName: r.yardName });
      }

      const vehInfo = (item: CartItemDto) => {
        const fromLot = item.lotNumber ? byLot.get(item.lotNumber) : undefined;
        const fromVin = item.vin ? byVin.get(item.vin) : undefined;
        const src = fromLot ?? fromVin;
        return {
          year: src?.year ?? null,
          make: src?.make ?? null,
          model: src?.model ?? null,
          vin: item.vin ?? fromLot?.vin ?? null,
        };
      };
      const inspIdFor = (item: CartItemDto) => {
        const m =
          (item.lotNumber && inspByLot.get(item.lotNumber)) ||
          (item.vin && inspByVin.get(item.vin)) ||
          null;
        return m ? m.id : null;
      };

      // ── Group by yard ───────────────────────────────────────────────────
      const groups = new Map<string, CartItemDto[]>();
      for (const item of items) {
        const key = item.yardId;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(item);
      }

      const byYard: OrderReceiptDetail['byYard'] = [];
      let travelSubtotalCents = 0;
      for (const [yardId, cars] of groups) {
        const yard = yardMap.get(yardId);
        const travelFeeCents = travelByYard.get(yardId) ?? yard?.travelFeeCents ?? DEFAULT_TRAVEL_FEE;
        travelSubtotalCents += travelFeeCents;
        const location =
          yard && (yard.city || yard.state) ? { city: yard.city, state: yard.state } : null;
        byYard.push({
          yardId,
          yardName: cars[0]?.yardName ?? yard?.name ?? null,
          location,
          cars: cars.length,
          inspectionFeeCents: inspectionFeeCents!,
          inspectionSubtotalCents: cars.length * inspectionFeeCents!,
          travelFeeCents,
          vehicles: cars.map((c) => {
            const v = vehInfo(c);
            return {
              inspectionId: inspIdFor(c),
              lotNumber: c.lotNumber ?? null,
              vin: v.vin,
              year: v.year,
              make: v.make,
              model: v.model,
            };
          }),
        });
      }

      const carsCount = items.length;
      const inspectionSubtotalCents = carsCount * inspectionFeeCents!;
      const totalCents =
        typeof meta.quote?.totalCents === 'number'
          ? meta.quote.totalCents
          : Math.round(Number(order.amount) * 100);

      const inspections: OrderReceiptDetail['inspections'] = inspectionRows.map((r) => {
        const src =
          (r.lotNumber && byLot.get(r.lotNumber)) ||
          (r.vin && byVin.get(r.vin)) ||
          null;
        return {
          id: r.id,
          vin: r.vin,
          lotNumber: r.lotNumber,
          year: src?.year ?? null,
          make: src?.make ?? null,
          model: src?.model ?? null,
          yardName: r.yardName,
        };
      });

      return {
        id: order.id,
        type: 'INSPECTION',
        receiptNumber: order.id.slice(0, 8).toUpperCase(),
        status: order.status,
        description: order.description,
        totalCents,
        carsCount,
        yardsCount: groups.size,
        inspectionSubtotalCents,
        travelSubtotalCents,
        inspectionFeeCents: inspectionFeeCents!,
        byYard,
        inspections,
      };
    } catch (err) {
      this.logger.warn(
        `buildOrderReceiptDetail: failed for order ${order.id} — ${(err as Error).message}`,
      );
      return null;
    }
  }

  // ── Quote ─────────────────────────────────────────────────────────────────

  /**
   * Computes a pricing breakdown for the cart WITHOUT creating any records.
   * Safe to call multiple times (read-only).
   * Soft validation: minCars violations are returned in the response (not thrown)
   * so the website can warn before the customer reaches checkout.
   */
  async quoteInspections(
    buyer: PortalBuyer,
    dto: InspectionCartDto,
  ): Promise<InspectionQuote> {
    const pricing = await this.pricingService.getPricing(buyer.tenantId);
    const yardFees = await this.resolveYardFees(dto.items);
    return this.computeQuote(dto.items, pricing, yardFees, false);
  }

  /**
   * Public quote — same breakdown, no auth, using the canonical tenant's fees.
   * Lets the cart show the price before the customer signs in. Creates nothing.
   * Soft validation: minCars violations returned but not thrown.
   */
  async quotePublic(dto: InspectionCartDto): Promise<InspectionQuote> {
    const pricing = await this.pricingService.getPricing(PORTAL_TENANT_ID);
    const yardFees = await this.resolveYardFees(dto.items);
    return this.computeQuote(dto.items, pricing, yardFees, false);
  }

  // ── Checkout ──────────────────────────────────────────────────────────────

  /**
   * CART CHECKOUT flow:
   *  1. Recompute total server-side (never trust client amounts).
   *  2. Create ONE PortalOrder (INSPECTION, PENDING) storing full cart in metadata.
   *  3. Create a Stripe Checkout Session for totalCents.
   *  4. Link session ID back to the order.
   *  5. Return the checkout URL.
   *
   * VehicleInspection rows are created later, in fulfillInspectionOrder,
   * after payment is confirmed via webhook.
   */
  async checkoutInspections(buyer: PortalBuyer, dto: InspectionCartDto) {
    const pricing = await this.pricingService.getPricing(buyer.tenantId);
    const yardFees = await this.resolveYardFees(dto.items);
    // Hard validation: throws BadRequestException if any yard fails minCars.
    const quote = this.computeQuote(dto.items, pricing, yardFees, true);

    // ── Customer-only 48-business-hour gate ──────────────────────────────────
    // Reject any cart item whose auction starts within 48 business hours from now.
    // Lots without a known auction date are always allowed through.
    const cutoff = addPortalBusinessHours(new Date(), PORTAL_MIN_LEAD_HOURS);
    for (const item of dto.items) {
      let lotKey: bigint;
      try { lotKey = BigInt(item.lotNumber); } catch { continue; }
      const listing = await this.prisma.auctionListing.findUnique({
        where: { lotNumber: lotKey },
        select: { saleDate: true, saleTime: true },
      });
      if (!listing) continue;
      const auctionAt = parsePortalAuctionDateTime(listing.saleDate, listing.saleTime);
      if (auctionAt && auctionAt < cutoff) {
        throw new BadRequestException(
          `El lote ${item.lotNumber} subasta pronto: se requieren al menos 48 horas hábiles para inspeccionar.`,
        );
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const description = `Vehicle inspections — ${quote.carsCount} car${quote.carsCount !== 1 ? 's' : ''}, ${quote.yardsCount} yard${quote.yardsCount !== 1 ? 's' : ''}`;

    // Create the PortalOrder first so we have an ID for Stripe metadata.
    const order = await this.prisma.portalOrder.create({
      data: {
        tenantId: buyer.tenantId,
        buyerId: buyer.id,
        type: 'INSPECTION',
        status: 'PENDING',
        amount: new Prisma.Decimal(quote.totalCents / 100),
        currency: 'usd',
        description,
        // Prisma requires a plain JSON-serializable object for Json fields.
        metadata: JSON.parse(
          JSON.stringify({
            items: dto.items,
            pricing: {
              inspectionFeeCents: pricing.inspectionFeeCents,
              travelFeeCents: pricing.travelFeeCents,
            },
            quote: {
              byYard: quote.byYard,
              carsCount: quote.carsCount,
              yardsCount: quote.yardsCount,
              inspectionSubtotalCents: quote.inspectionSubtotalCents,
              travelSubtotalCents: quote.travelSubtotalCents,
              totalCents: quote.totalCents,
            },
          }),
        ),
      },
    });

    const stripeCustomerId = await this.getOrCreateStripeCustomer(buyer);

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      customer: stripeCustomerId,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            // Server-computed total — the single source of truth.
            unit_amount: quote.totalCents,
            product_data: {
              name: `Vehicle Inspections (${quote.carsCount} car${quote.carsCount !== 1 ? 's' : ''}, ${quote.yardsCount} yard${quote.yardsCount !== 1 ? 's' : ''})`,
              description: quote.byYard
                .map(
                  (y) =>
                    `${y.yardName ?? y.yardId}: ${y.cars} car${y.cars !== 1 ? 's' : ''}`,
                )
                .join(' | '),
            },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        description,
        // Save the card so the buyer can see and reuse it later.
        setup_future_usage: 'off_session',
        metadata: {
          portalOrderId: order.id,
          buyerId: buyer.id,
          tenantId: buyer.tenantId,
        },
      },
      metadata: {
        portalOrderId: order.id,
        buyerId: buyer.id,
        tenantId: buyer.tenantId,
        orderType: 'INSPECTION',
      },
      success_url: `${this.portalBaseUrl()}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.portalBaseUrl()}/payment/canceled?session_id={CHECKOUT_SESSION_ID}`,
    });

    // Link the Stripe session ID back to the order.
    await this.prisma.portalOrder.update({
      where: { id: order.id },
      data: { stripeCheckoutSessionId: session.id },
    });

    this.logger.log(
      `Portal inspection order ${order.id} created (${quote.carsCount} cars, ${quote.yardsCount} yards, $${(quote.totalCents / 100).toFixed(2)}) — Stripe session ${session.id}`,
    );

    return {
      orderId: order.id,
      url: session.url,
      checkoutUrl: session.url,
      totalCents: quote.totalCents,
      currency: 'usd' as const,
      breakdown: quote,
    };
  }

  // ── Ledger ────────────────────────────────────────────────────────────────

  /**
   * Returns all ledger entries for the buyer plus a computed running balance.
   * Balance = sum(DEPOSIT+REFUND where COMPLETED) - sum(CHARGE+APPLIED where COMPLETED).
   */
  async getLedger(buyer: PortalBuyer) {
    const entries = await this.prisma.customerLedgerEntry.findMany({
      where: { buyerId: buyer.id, tenantId: buyer.tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        type: true,
        status: true,
        amount: true,
        currency: true,
        description: true,
        source: true,
        stripePaymentIntentId: true,
        relatedInspectionId: true,
        createdAt: true,
      },
    });

    let balanceCents = 0;
    for (const e of entries) {
      if (e.status !== 'COMPLETED') continue;
      const cents = Math.round(Number(e.amount) * 100);
      if (e.type === 'DEPOSIT' || e.type === 'REFUND') {
        balanceCents += cents;
      } else if (e.type === 'CHARGE' || e.type === 'APPLIED') {
        balanceCents -= cents;
      }
      // ADJUSTMENT: positive amount = credit, negative = debit
      else if (e.type === 'ADJUSTMENT') {
        balanceCents += cents;
      }
    }

    return {
      entries: entries.map((e) => ({
        ...e,
        amount: e.amount.toString(),
      })),
      balanceCents,
      balanceFormatted: `$${(balanceCents / 100).toFixed(2)}`,
    };
  }

  // ── Deposits ──────────────────────────────────────────────────────────────

  /**
   * Create a Stripe Checkout Session for an arbitrary deposit amount.
   * The CustomerLedgerEntry is created in the webhook handler after payment.
   */
  async createDeposit(buyer: PortalBuyer, dto: CreateDepositDto) {
    if (dto.amountCents < MIN_DEPOSIT_CENTS) {
      // Validated by DTO; this is a belt-and-suspenders guard.
      throw new Error(
        `Minimum deposit is $${(MIN_DEPOSIT_CENTS / 100).toFixed(2)}`,
      );
    }

    const order = await this.prisma.portalOrder.create({
      data: {
        tenantId: buyer.tenantId,
        buyerId: buyer.id,
        type: 'DEPOSIT',
        status: 'PENDING',
        amount: new Prisma.Decimal(dto.amountCents / 100),
        currency: 'usd',
        description: 'Account deposit',
      },
    });

    const stripeCustomerId = await this.getOrCreateStripeCustomer(buyer);

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      customer: stripeCustomerId,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: dto.amountCents,
            product_data: { name: 'Account Deposit' },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        description: 'Portal account deposit',
        // Save the card so the buyer can see and reuse it later.
        setup_future_usage: 'off_session',
        metadata: {
          portalOrderId: order.id,
          buyerId: buyer.id,
          tenantId: buyer.tenantId,
        },
      },
      metadata: {
        portalOrderId: order.id,
        buyerId: buyer.id,
        tenantId: buyer.tenantId,
        orderType: 'DEPOSIT',
      },
      success_url: `${this.portalBaseUrl()}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.portalBaseUrl()}/payment/canceled?session_id={CHECKOUT_SESSION_ID}`,
    });

    await this.prisma.portalOrder.update({
      where: { id: order.id },
      data: { stripeCheckoutSessionId: session.id },
    });

    this.logger.log(
      `Portal deposit order ${order.id} created — Stripe session ${session.id}`,
    );

    return {
      orderId: order.id,
      url: session.url,
      checkoutUrl: session.url,
      amountCents: dto.amountCents,
    };
  }

  // ── Find a Car for Me ─────────────────────────────────────────────────────

  /**
   * Create a Stripe Checkout Session for the "Find a Car for Me" service.
   * Saves vehicle preferences in PortalOrder.metadata; actual BuyerVehiclePreference
   * rows are created by fulfillFindACarOrder after successful payment.
   */
  async checkoutFindACar(
    buyer: PortalBuyer,
    dto: FindACarCheckoutDto,
  ): Promise<{ orderId: string; url: string | null; checkoutUrl: string | null }> {
    if (!dto.acceptedTerms) {
      throw new BadRequestException(
        'Debes aceptar los términos y condiciones',
      );
    }
    if (!dto.preferences?.length) {
      throw new BadRequestException(
        'Debes especificar al menos una preferencia de vehículo',
      );
    }

    const order = await this.prisma.portalOrder.create({
      data: {
        tenantId: buyer.tenantId,
        buyerId: buyer.id,
        type: 'SERVICE',
        status: 'PENDING',
        amount: new Prisma.Decimal(FIND_A_CAR_PRICE_CENTS / 100),
        currency: 'usd',
        description: `Find a Car for Me — ${dto.preferences.length} vehículo(s)`,
        metadata: JSON.parse(
          JSON.stringify({
            service: 'find-a-car',
            preferences: dto.preferences,
            acceptedTerms: true,
          }),
        ),
      },
    });

    const stripeCustomerId = await this.getOrCreateStripeCustomer(buyer);

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      customer: stripeCustomerId,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: FIND_A_CAR_PRICE_CENTS,
            product_data: {
              name: 'Find a Car for Me',
              description:
                'Inspección onsite de 6 vehículos + Carfax + búsqueda de historial + puja hasta ganar + tramitación de envío. No incluye fee de Copart, brokeraje ni envío.',
            },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        description: 'Find a Car for Me service',
        setup_future_usage: 'off_session',
        metadata: {
          portalOrderId: order.id,
          buyerId: buyer.id,
          tenantId: buyer.tenantId,
        },
      },
      metadata: {
        portalOrderId: order.id,
        buyerId: buyer.id,
        tenantId: buyer.tenantId,
        orderType: 'SERVICE',
      },
      success_url: `${this.portalBaseUrl()}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.portalBaseUrl()}/payment/canceled?session_id={CHECKOUT_SESSION_ID}`,
    });

    await this.prisma.portalOrder.update({
      where: { id: order.id },
      data: { stripeCheckoutSessionId: session.id },
    });

    this.logger.log(
      `Find-a-Car order ${order.id} created — Stripe session ${session.id}`,
    );

    return {
      orderId: order.id,
      url: session.url,
      checkoutUrl: session.url,
    };
  }

  // ── Stripe fulfillment (called from StripeService webhook) ────────────────

  /**
   * Processes a `checkout.session.completed` event for a PortalOrder.
   * Idempotent — safe to call multiple times with the same session ID.
   */
  async fulfillPortalOrder(session: Stripe.Checkout.Session): Promise<void> {
    const portalOrderId = session.metadata?.portalOrderId;
    if (!portalOrderId) return; // Not a portal order — skip.

    const order = await this.prisma.portalOrder.findUnique({
      where: { id: portalOrderId },
    });
    if (!order) {
      this.logger.warn(
        `fulfillPortalOrder: PortalOrder ${portalOrderId} not found`,
      );
      return;
    }

    // Idempotency guard.
    if (order.status === 'PAID' || order.status === 'FULFILLED') {
      this.logger.log(
        `fulfillPortalOrder: order ${portalOrderId} already ${order.status} — skipping`,
      );
      return;
    }

    const piId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id ?? null;

    // Mark PAID first.
    await this.prisma.portalOrder.update({
      where: { id: order.id },
      data: {
        status: 'PAID',
        stripePaymentIntentId: piId ?? undefined,
      },
    });

    if (order.type === 'INSPECTION') {
      await this.fulfillInspectionOrder(order, piId);
    } else if (order.type === 'DEPOSIT') {
      await this.fulfillDepositOrder(order, piId);
    } else if (order.type === 'SERVICE') {
      await this.fulfillFindACarOrder(order, piId);
    }
  }

  // ── Private: fulfillment helpers ──────────────────────────────────────────

  /**
   * Cart fulfillment: creates one VehicleInspection per item in metadata.items.
   * Falls back gracefully to single-inspection (legacy metadata shape) so any
   * orders created before the cart migration still get fulfilled correctly.
   *
   * Idempotency: the outer guard in fulfillPortalOrder checks order.status
   * BEFORE we enter here, so if we were already FULFILLED we never re-enter.
   */
  private async fulfillInspectionOrder(
    order: {
      id: string;
      buyerId: string;
      tenantId: string | null;
      metadata: unknown;
    },
    piId: string | null,
  ): Promise<void> {
    const meta = (order.metadata ?? {}) as Record<string, unknown>;
    const tenantId = order.tenantId ?? '';

    // ── Determine cart items ────────────────────────────────────────────────
    // New shape: metadata.items = CartItemDto[]
    // Legacy shape (single inspection): metadata.vin, metadata.lotNumber, etc.
    let items: CartItemDto[];

    const rawItems = meta['items'];
    if (Array.isArray(rawItems) && rawItems.length > 0) {
      items = rawItems as CartItemDto[];
    } else {
      // Legacy single-car order — reconstruct a synthetic cart item.
      const vin = (meta['vin'] as string) ?? '';
      if (!vin) {
        this.logger.error(
          `fulfillInspectionOrder: PortalOrder ${order.id} has no VIN and no items in metadata`,
        );
        return;
      }
      items = [
        {
          lotNumber: (meta['lotNumber'] as string) ?? '',
          vin,
          yardId: (meta['yardNumber'] as string) ?? '',
          yardName: (meta['yardName'] as string) ?? undefined,
        },
      ];
    }

    // ── Create one VehicleInspection per cart item ──────────────────────────
    const createdIds: string[] = [];

    for (const item of items) {
      try {
        const inspection = await this.inspectionsService.create(
          tenantId,
          null,
          {
            vin: item.vin ?? item.lotNumber, // fallback: lot as vin placeholder
            lotNumber: item.lotNumber || undefined,
            yardId: item.yardId || undefined,
            yardName: item.yardName || undefined,
            buyerId: order.buyerId,
            status: 'REQUESTED',
          } as any,
        );
        createdIds.push((inspection as any).id);
        this.logger.log(
          `fulfillInspectionOrder: created inspection ${(inspection as any).id} for lot ${item.lotNumber} (order ${order.id})`,
        );
      } catch (err) {
        this.logger.error(
          `fulfillInspectionOrder: failed to create inspection for lot ${item.lotNumber} (order ${order.id}): ${(err as Error).message}`,
        );
        // Continue processing the rest of the cart — do not abort the entire
        // fulfillment because one item failed.
      }
    }

    // Store created inspection IDs in metadata and mark FULFILLED.
    const updatedMetadata = {
      ...(meta as object),
      fulfilledInspectionIds: createdIds,
    };

    await this.prisma.portalOrder.update({
      where: { id: order.id },
      data: {
        status: 'FULFILLED',
        // Link the first inspection for the legacy relatedInspectionId column.
        ...(createdIds.length > 0 && {
          relatedInspectionId: createdIds[0],
        }),
        metadata: updatedMetadata,
      },
    });

    this.logger.log(
      `fulfillInspectionOrder: order ${order.id} FULFILLED — ${createdIds.length}/${items.length} inspections created`,
    );

    // ── Notify staff ──────────────────────────────────────────────────────────
    if (createdIds.length > 0) {
      try {
        const buyer = await this.prisma.buyer.findUnique({
          where: { id: order.buyerId },
          select: { firstName: true, lastName: true },
        });
        const buyerName = buyer
          ? `${buyer.firstName} ${buyer.lastName}`.trim()
          : order.buyerId;
        const count = createdIds.length;
        const lotNumbers = items.map((i) => i.lotNumber).filter(Boolean).join(', ');
        await this.notifications.notifyTenantStaff(tenantId, {
          title: 'Nueva solicitud de inspección',
          message: `${buyerName} solicitó ${count} inspección${count !== 1 ? 'es' : ''}${lotNumbers ? ` (${lotNumbers})` : ''}`,
          type: 'CUSTOMER_INSPECTION_REQUESTED',
          entityType: 'PortalOrder',
          entityId: order.id,
          actionUrl: `${this.dashboardBaseUrl()}/inspections`,
          metaValue: {
            buyerId: order.buyerId,
            buyerName,
            count,
            lotNumbers: items.map((i) => i.lotNumber).filter(Boolean),
            vins: items.map((i) => i.vin).filter(Boolean),
            orderId: order.id,
          } as Record<string, unknown>,
        });
      } catch {
        // best-effort: never throw
      }
    }
  }

  private async fulfillDepositOrder(
    order: {
      id: string;
      buyerId: string;
      tenantId: string | null;
      amount: Prisma.Decimal;
      currency: string;
    },
    piId: string | null,
  ): Promise<void> {
    await this.prisma.customerLedgerEntry.create({
      data: {
        tenantId: order.tenantId,
        buyerId: order.buyerId,
        type: 'DEPOSIT',
        status: 'COMPLETED',
        amount: order.amount,
        currency: order.currency,
        description: 'Portal deposit',
        source: 'stripe',
        stripePaymentIntentId: piId,
      },
    });

    await this.prisma.portalOrder.update({
      where: { id: order.id },
      data: { status: 'FULFILLED' },
    });

    this.logger.log(
      `fulfillDepositOrder: order ${order.id} fulfilled — ledger entry created`,
    );

    // ── Notify staff ──────────────────────────────────────────────────────────
    try {
      const buyer = await this.prisma.buyer.findUnique({
        where: { id: order.buyerId },
        select: { firstName: true, lastName: true },
      });
      const buyerName = buyer
        ? `${buyer.firstName} ${buyer.lastName}`.trim()
        : order.buyerId;
      const tenantId = order.tenantId ?? '';
      const amountDollars = Number(order.amount).toFixed(2);
      await this.notifications.notifyTenantStaff(tenantId, {
        title: 'Depósito recibido',
        message: `${buyerName} realizó un depósito de $${amountDollars}`,
        type: 'CUSTOMER_DEPOSIT',
        entityType: 'PortalOrder',
        entityId: order.id,
        actionUrl: `${this.dashboardBaseUrl()}/buyers/${order.buyerId}`,
        metaValue: {
          buyerId: order.buyerId,
          buyerName,
          amountDollars,
          currency: order.currency,
          orderId: order.id,
        } as Record<string, unknown>,
      });
    } catch {
      // best-effort: never throw
    }
  }

  private async fulfillFindACarOrder(
    order: {
      id: string;
      buyerId: string;
      tenantId: string | null;
      metadata: unknown;
    },
    _piId: string | null,
  ): Promise<void> {
    const meta = (order.metadata ?? {}) as Record<string, unknown>;

    if (meta['service'] !== 'find-a-car') {
      // Unknown SERVICE sub-type — just mark fulfilled and log.
      await this.prisma.portalOrder.update({
        where: { id: order.id },
        data: { status: 'FULFILLED' },
      });
      this.logger.warn(
        `fulfillFindACarOrder: order ${order.id} has unknown service type "${String(meta['service'])}" — marked FULFILLED without side effects`,
      );
      return;
    }

    const preferences = Array.isArray(meta['preferences'])
      ? (meta['preferences'] as Record<string, unknown>[])
      : [];

    const createdPreferenceIds: string[] = [];
    const vehicleSummaries: string[] = [];

    for (const pref of preferences) {
      try {
        const yf = pref['yearFrom'] != null ? Number(pref['yearFrom']) : null;
        const yt = pref['yearTo'] != null ? Number(pref['yearTo']) : null;
        const mk = String(pref['make'] ?? '').trim();
        const mdl = Array.isArray(pref['models']) ? (pref['models'] as string[]) : [];
        const yearPart = yf && yt ? `${yf}-${yt} ` : yf ? `${yf}+ ` : '';
        const modelPart = mdl.length
          ? ` ${mdl.slice(0, 2).join(', ')}${mdl.length > 2 ? ` +${mdl.length - 2}` : ''}`
          : '';
        const summary = `${yearPart}${mk}${modelPart}`.trim();
        const created = await this.prisma.buyerVehiclePreference.create({
          data: {
            buyerId: order.buyerId,
            tenantId: order.tenantId,
            make: String(pref['make'] ?? ''),
            yearFrom: pref['yearFrom'] != null ? Number(pref['yearFrom']) : null,
            yearTo: pref['yearTo'] != null ? Number(pref['yearTo']) : null,
            models: Array.isArray(pref['models']) ? (pref['models'] as string[]) : [],
            trims: Array.isArray(pref['trims']) ? (pref['trims'] as string[]) : [],
            maxMileage: pref['maxMileage'] != null ? Number(pref['maxMileage']) : null,
            titleTypes: Array.isArray(pref['titleTypes']) ? (pref['titleTypes'] as string[]) : [],
            colors: Array.isArray(pref['colors']) ? (pref['colors'] as string[]) : [],
            maxCost: pref['maxCost'] != null ? new Prisma.Decimal(Number(pref['maxCost'])) : null,
            notes: pref['notes'] != null ? String(pref['notes']) : null,
            paid: true,
            paidAt: new Date(),
            source: 'web-find-a-car',
            portalOrderId: order.id,
          },
        });
        createdPreferenceIds.push(created.id);
        if (summary) vehicleSummaries.push(summary);
        this.logger.log(
          `fulfillFindACarOrder: created BuyerVehiclePreference ${created.id} for order ${order.id}`,
        );
      } catch (err) {
        this.logger.error(
          `fulfillFindACarOrder: failed to create preference for order ${order.id}: ${(err as Error).message}`,
        );
        // Continue — do not abort the entire fulfillment for one failed preference.
      }
    }

    await this.prisma.portalOrder.update({
      where: { id: order.id },
      data: {
        status: 'FULFILLED',
        metadata: {
          ...(meta as object),
          createdPreferenceIds,
        },
      },
    });

    this.logger.log(
      `fulfillFindACarOrder: order ${order.id} FULFILLED — ${createdPreferenceIds.length}/${preferences.length} preferences created`,
    );

    // ── Notify staff ──────────────────────────────────────────────────────────
    try {
      const tenantId = order.tenantId ?? '';
      const buyer = await this.prisma.buyer.findUnique({
        where: { id: order.buyerId },
        select: { firstName: true, lastName: true },
      });
      const buyerName = buyer
        ? `${buyer.firstName} ${buyer.lastName}`.trim()
        : order.buyerId;
      const vehiclesCount = createdPreferenceIds.length;
      await this.notifications.notifyTenantStaff(tenantId, {
        title: 'Solicitud Find a Car for Me',
        message: `${buyerName} solicitó Find a Car for Me (${vehiclesCount} ${vehiclesCount === 1 ? 'vehículo' : 'vehículos'})`,
        type: 'CUSTOMER_FIND_A_CAR',
        entityType: 'PortalOrder',
        entityId: order.id,
        // Relative SPA path → opens the customer on For Bids ▸ Wanted Vehicles.
        actionUrl: `/dashboard/customers/${order.buyerId}/edit#for-bids-wanted`,
        metaValue: {
          buyerId: order.buyerId,
          buyerName,
          preferencesCount: vehiclesCount,
          vehicles: vehicleSummaries,
          orderId: order.id,
        } as Record<string, unknown>,
      });
    } catch {
      // best-effort: never throw
    }
  }

  // ── Private: pricing computation ──────────────────────────────────────────

  /**
   * Resolve per-yard fee data from the DB for a set of cart items.
   * Missing yards fall back to defaults (5000 cents, minCars=1).
   */
  private async resolveYardFees(
    items: CartItemDto[],
  ): Promise<Map<string, YardFeeData>> {
    const yardIds = Array.from(new Set(items.map((i) => i.yardId)));
    const rows = await this.prisma.yard.findMany({
      where: { id: { in: yardIds } },
      select: { id: true, name: true, travelFeeCents: true, minCars: true },
    });
    const map = new Map<string, YardFeeData>();
    for (const r of rows) {
      map.set(r.id, {
        travelFeeCents: r.travelFeeCents,
        minCars: r.minCars,
        name: r.name,
      });
    }
    return map;
  }

  /**
   * Groups items by yardId and computes totals using per-yard travel fees.
   *
   * Formula:
   *   total = (numberOfCars × inspectionFeeCents) + Σ over distinct yards (yard.travelFeeCents)
   *
   * @param hardValidate - when true, throws BadRequestException on minCars violations;
   *                       when false, populates minCarsViolations[] instead.
   */
  private computeQuote(
    items: CartItemDto[],
    pricing: PortalPricing,
    yardFees: Map<string, YardFeeData>,
    hardValidate: boolean,
  ): InspectionQuote {
    const DEFAULT_TRAVEL_FEE = 5000;
    const DEFAULT_MIN_CARS = 1;

    // Group by yardId.
    const yardMap = new Map<string, YardGroup>();
    for (const item of items) {
      if (!yardMap.has(item.yardId)) {
        yardMap.set(item.yardId, {
          yardId: item.yardId,
          yardName: item.yardName,
          cars: [],
        });
      }
      yardMap.get(item.yardId)!.cars.push(item);
    }

    const minCarsViolations: InspectionQuote['minCarsViolations'] = [];

    const byYard = Array.from(yardMap.values()).map((g) => {
      const fee = yardFees.get(g.yardId);
      const travelFeeCents = fee?.travelFeeCents ?? DEFAULT_TRAVEL_FEE;
      const minCars = fee?.minCars ?? DEFAULT_MIN_CARS;
      const yardName = g.yardName ?? fee?.name ?? g.yardId;
      const actual = g.cars.length;

      if (actual < minCars) {
        minCarsViolations.push({
          yardId: g.yardId,
          yardName,
          required: minCars,
          actual,
        });
      }

      return {
        yardId: g.yardId,
        yardName: g.yardName ?? fee?.name,
        cars: actual,
        travelFeeCents,
        minCars,
      };
    });

    // Hard-block at checkout; soft-warn at quote.
    if (hardValidate && minCarsViolations.length > 0) {
      const msgs = minCarsViolations.map(
        (v) =>
          `${v.yardName} requiere mínimo ${v.required} vehículo${v.required !== 1 ? 's' : ''} para inspección (tienes ${v.actual})`,
      );
      throw new BadRequestException(msgs.join('. '));
    }

    const carsCount = items.length;
    const yardsCount = yardMap.size;
    const inspectionSubtotalCents = carsCount * pricing.inspectionFeeCents;
    const travelSubtotalCents = byYard.reduce(
      (sum, y) => sum + y.travelFeeCents,
      0,
    );
    const totalCents = inspectionSubtotalCents + travelSubtotalCents;

    return {
      items,
      byYard,
      carsCount,
      yardsCount,
      inspectionFeeCents: pricing.inspectionFeeCents,
      travelFeeCents: travelSubtotalCents, // aggregate for legacy compat
      inspectionSubtotalCents,
      travelSubtotalCents,
      totalCents,
      currency: 'usd',
      minCarsViolations,
    };
  }

  // ── Deposit release requests (buyer-facing) ───────────────────────────────

  /**
   * Idempotent: if a PENDING request already exists for this buyer, return it.
   * Otherwise create a new one from the current ledger balance.
   * Throws 400 when balance is <= 0.
   */
  async createDepositReleaseRequest(buyer: PortalBuyer, note?: string) {
    const { balanceCents } = await this.getLedger(buyer);
    if (balanceCents <= 0) {
      throw new BadRequestException('No tienes saldo disponible para liberar');
    }

    // Idempotency: return existing PENDING request if one exists.
    const existing = await this.prisma.depositReleaseRequest.findFirst({
      where: { buyerId: buyer.id, tenantId: buyer.tenantId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return { ...existing, amount: existing.amount.toString() };
    }

    const created = await this.prisma.depositReleaseRequest.create({
      data: {
        tenantId: buyer.tenantId,
        buyerId: buyer.id,
        amount: new Prisma.Decimal(balanceCents / 100),
        currency: 'usd',
        status: 'PENDING',
        note,
      },
    });

    // ── Notify staff (only on new request, not when returning existing) ───────
    try {
      const buyerName = `${buyer.firstName} ${buyer.lastName}`.trim();
      await this.notifications.notifyTenantStaff(buyer.tenantId, {
        title: 'Solicitud de liberación de depósito',
        message: `${buyerName} solicitó la liberación de su depósito`,
        type: 'CUSTOMER_DEPOSIT_RELEASE',
        entityType: 'DepositReleaseRequest',
        entityId: created.id,
        actionUrl: `${this.dashboardBaseUrl()}/buyers/${buyer.id}`,
        metaValue: {
          buyerId: buyer.id,
          buyerName,
          amountDollars: created.amount.toString(),
          requestId: created.id,
        } as Record<string, unknown>,
      });
    } catch {
      // best-effort: never throw
    }

    return { ...created, amount: created.amount.toString() };
  }

  /** Returns the most recent DepositReleaseRequest for the buyer, or null. */
  async getLatestDepositReleaseRequest(buyer: PortalBuyer) {
    const req = await this.prisma.depositReleaseRequest.findFirst({
      where: { buyerId: buyer.id, tenantId: buyer.tenantId },
      orderBy: { createdAt: 'desc' },
    });
    if (!req) return null;
    return { ...req, amount: req.amount.toString() };
  }

  // ── Contact form (public) ─────────────────────────────────────────────────

  /**
   * Saves a contact message and notifies tenant staff.
   * Resolves tenantId from tenantSlug when provided; falls back to PORTAL_TENANT_ID.
   * Public endpoint — no auth context available.
   */
  async submitContactForm(data: {
    name: string;
    email: string;
    phone?: string;
    subject?: string;
    message: string;
    tenantSlug?: string;
    buyerId?: string;
  }): Promise<{ ok: boolean }> {
    // Resolve tenantId from slug, or fall back to the portal tenant.
    let tenantId = PORTAL_TENANT_ID;
    if (data.tenantSlug) {
      const tenant = await this.prisma.tenant.findFirst({
        where: { slug: data.tenantSlug },
        select: { id: true },
      });
      if (tenant) tenantId = tenant.id;
    }

    const contactMessage = await this.prisma.contactMessage.create({
      data: {
        tenantId,
        buyerId: data.buyerId ?? null,
        name: data.name,
        email: data.email,
        phone: data.phone ?? null,
        subject: data.subject ?? null,
        message: data.message,
        status: 'NEW',
      },
    });

    // ── Notify staff (best-effort) ─────────────────────────────────────────
    try {
      await this.notifications.notifyTenantStaff(tenantId, {
        title: 'Nuevo mensaje de contacto',
        message: `Nuevo mensaje de contacto de ${data.name}`,
        type: 'CUSTOMER_CONTACT_MESSAGE',
        entityType: 'ContactMessage',
        entityId: contactMessage.id,
        actionUrl: `${this.dashboardBaseUrl()}/contact-messages`,
        metaValue: {
          name: data.name,
          email: data.email,
          phone: data.phone ?? null,
          subject: data.subject ?? null,
          message: data.message,
          contactMessageId: contactMessage.id,
        } as Record<string, unknown>,
      });
    } catch {
      // best-effort: never throw
    }

    return { ok: true };
  }

  // ── Orders (buyer-facing, for receipt PDF) ────────────────────────────────

  /** Load a single PortalOrder scoped to the buyer's tenant. */
  async getOrderForBuyer(
    orderId: string,
    buyer: PortalBuyer,
  ) {
    const order = await this.prisma.portalOrder.findFirst({
      where: { id: orderId, buyerId: buyer.id, tenantId: buyer.tenantId },
    });
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    return order;
  }

  // ── Private: Stripe helpers ───────────────────────────────────────────────

  private portalBaseUrl(): string {
    return process.env.PORTAL_BASE_URL ?? 'https://htownautos.com';
  }

  /** Base URL for the staff dashboard. */
  private dashboardBaseUrl(): string {
    return process.env.DASHBOARD_BASE_URL ?? 'https://app.htownautos.com';
  }

  private async getOrCreateStripeCustomer(buyer: PortalBuyer): Promise<string> {
    const fresh = await this.prisma.buyer.findFirst({
      where: { id: buyer.id, tenantId: buyer.tenantId },
      select: { stripeCustomerId: true },
    });

    if (fresh?.stripeCustomerId) return fresh.stripeCustomerId;

    const customer = await this.stripe.customers.create({
      email: buyer.email || undefined,
      name: `${buyer.firstName} ${buyer.lastName}`.trim(),
      phone: buyer.phoneMain || undefined,
      metadata: { buyerId: buyer.id, tenantId: buyer.tenantId },
    });

    await this.prisma.buyer.update({
      where: { id: buyer.id },
      data: { stripeCustomerId: customer.id },
    });

    return customer.id;
  }
}
