import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { S3Service } from '@htownautos/common';
import { VehicleHistoryExtractionService } from './vehicle-history-extraction.service';

export type LibrarySource = 'carfax_reports' | 'vehicle_history_reports';

const LIBRARY_SOURCES: LibrarySource[] = ['carfax_reports', 'vehicle_history_reports'];

export interface LibraryQuery {
  page?: number;
  pageSize?: number;
  vin?: string;
  reportType?: 'carfax' | 'autocheck';
  origin?: 'crm' | 'api' | 'upload';
  parseStatus?: 'ok' | 'partial' | 'unsupported' | 'failed' | 'none';
  from?: string;
  to?: string;
}

interface RequestedByRef {
  requestedBy: string | null;
  tenantId: string | null;
}

export interface ResolvedRequestedBy {
  kind: 'user' | 'api-key' | 'system';
  id: string | null;
  name: string | null;
  tenantName: string | null;
}

interface LibraryRow {
  source: LibrarySource;
  id: string;
  vin: string | null;
  reportType: 'carfax' | 'autocheck';
  providerKey: string | null;
  contentType: string;
  yearMakeModel: string | null;
  auctionListingId: string | null;
  createdAt: Date;
  reportDate: Date | null;
  origin: 'crm' | 'api' | 'upload';
  requestedBy: string | null;
  tenantId: string | null;
  parseStatus: string | null;
  confidence: Prisma.Decimal | string | null;
  template: string | null;
  llmUsed: boolean | null;
  accidentCount: number | null;
  ownerCount: number | null;
  lastOdometer: number | null;
  brandedTitle: boolean | null;
  totalLoss: boolean | null;
  salvage: boolean | null;
  flood: boolean | null;
  structuralDamage: boolean | null;
  airbagDeployed: boolean | null;
  odometerRollbackSuspected: boolean | null;
}

/** Union of the two report tables (carfax_reports, vehicle_history_reports) + their parse, for the admin Reports library. */
@Injectable()
export class VehicleHistoryLibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly extractions: VehicleHistoryExtractionService,
  ) {}

  private buildCte() {
    return Prisma.sql`
      WITH vh AS (
        SELECT
          'vehicle_history_reports'::text AS source,
          r.id,
          r.vin,
          r."reportType" AS "reportType",
          r."providerKey" AS "providerKey",
          r."contentType" AS "contentType",
          r."yearMakeModel" AS "yearMakeModel",
          NULL::text AS "auctionListingId",
          r."createdAt" AS "createdAt",
          p."reportDate" AS "reportDate",
          CASE WHEN req.source = 'api' THEN 'api' ELSE 'crm' END AS origin,
          req."requestedBy" AS "requestedBy",
          req."tenantId" AS "tenantId",
          p.status AS "parseStatus",
          p.confidence,
          p.template,
          p."llmUsed" AS "llmUsed",
          p."accidentCount" AS "accidentCount",
          p."ownerCount" AS "ownerCount",
          p."lastOdometer" AS "lastOdometer",
          p."brandedTitle" AS "brandedTitle",
          p."totalLoss" AS "totalLoss",
          p.salvage,
          p.flood,
          p."structuralDamage" AS "structuralDamage",
          p."airbagDeployed" AS "airbagDeployed",
          p."odometerRollbackSuspected" AS "odometerRollbackSuspected"
        FROM vehicle_history_reports r
        LEFT JOIN vehicle_history_parsed p ON p."s3Key" = r."s3Key"
        LEFT JOIN LATERAL (
          SELECT req2.source, req2."requestedBy", req2."tenantId"
          FROM vehicle_history_requests req2
          WHERE req2."reportId" = r.id AND req2."cacheHit" = false
          ORDER BY req2."createdAt" ASC
          LIMIT 1
        ) req ON true
      ),
      cf AS (
        SELECT
          'carfax_reports'::text AS source,
          c.id,
          c.vin,
          'carfax'::text AS "reportType",
          NULL::text AS "providerKey",
          CASE
            WHEN c."s3Key" ILIKE '%.pdf' THEN 'application/pdf'
            WHEN c."s3Key" ILIKE '%.htm' OR c."s3Key" ILIKE '%.html' THEN 'text/html'
            WHEN p.template ILIKE '%pdf%' THEN 'application/pdf'
            ELSE 'text/html'
          END AS "contentType",
          NULL::text AS "yearMakeModel",
          c."auctionListingId"::text AS "auctionListingId",
          c."createdAt" AS "createdAt",
          c.date AS "reportDate",
          'upload'::text AS origin,
          NULL::text AS "requestedBy",
          NULL::text AS "tenantId",
          p.status AS "parseStatus",
          p.confidence,
          p.template,
          p."llmUsed" AS "llmUsed",
          p."accidentCount" AS "accidentCount",
          p."ownerCount" AS "ownerCount",
          p."lastOdometer" AS "lastOdometer",
          p."brandedTitle" AS "brandedTitle",
          p."totalLoss" AS "totalLoss",
          p.salvage,
          p.flood,
          p."structuralDamage" AS "structuralDamage",
          p."airbagDeployed" AS "airbagDeployed",
          p."odometerRollbackSuspected" AS "odometerRollbackSuspected"
        FROM carfax_reports c
        LEFT JOIN vehicle_history_parsed p ON p."s3Key" = c."s3Key"
      ),
      combined AS (
        SELECT * FROM vh UNION ALL SELECT * FROM cf
      )
    `;
  }

  private buildWhere(q: LibraryQuery) {
    const conditions: Prisma.Sql[] = [];
    if (q.vin) conditions.push(Prisma.sql`combined.vin ILIKE ${q.vin.toUpperCase().trim() + '%'}`);
    if (q.reportType) conditions.push(Prisma.sql`combined."reportType" = ${q.reportType}`);
    if (q.origin) conditions.push(Prisma.sql`combined.origin = ${q.origin}`);
    if (q.parseStatus === 'none') conditions.push(Prisma.sql`combined."parseStatus" IS NULL`);
    else if (q.parseStatus) conditions.push(Prisma.sql`combined."parseStatus" = ${q.parseStatus}`);
    if (q.from) {
      const d = new Date(q.from);
      if (isNaN(d.getTime())) throw new BadRequestException('Invalid "from" date');
      conditions.push(Prisma.sql`combined."createdAt" >= ${d}`);
    }
    if (q.to) {
      const d = new Date(q.to);
      if (isNaN(d.getTime())) throw new BadRequestException('Invalid "to" date');
      conditions.push(Prisma.sql`combined."createdAt" <= ${d}`);
    }
    return conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
  }

  async list(q: LibraryQuery) {
    const page = Math.max(1, q.page || 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize || 25));
    const cte = this.buildCte();
    const whereSql = this.buildWhere(q);

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<LibraryRow[]>`
        ${cte}
        SELECT * FROM combined
        ${whereSql}
        ORDER BY "createdAt" DESC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
      `,
      this.prisma.$queryRaw<{ count: bigint }[]>`
        ${cte}
        SELECT count(*)::bigint AS count FROM combined
        ${whereSql}
      `,
    ]);

    const items = await this.hydrate(rows);
    return { items, total: Number(countRows[0]?.count ?? 0), page, pageSize };
  }

  async getOne(source: string, id: string) {
    this.assertSource(source);
    const cte = this.buildCte();
    const rows = await this.prisma.$queryRaw<LibraryRow[]>`
      ${cte}
      SELECT * FROM combined WHERE source = ${source} AND id = ${id} LIMIT 1
    `;
    if (!rows.length) throw new NotFoundException('Report not found');
    const [report] = await this.hydrate(rows);

    const parsed = await this.prisma.vehicleHistoryParsed.findFirst({
      where: { source, sourceId: id },
      include: {
        odometerReadings: { orderBy: { date: 'asc' } },
        damageEvents: { orderBy: { date: 'asc' } },
        titleEvents: { orderBy: { date: 'asc' } },
        ownershipPeriods: { orderBy: { start: 'asc' } },
      },
    });

    let requests: Array<{
      id: string;
      status: string;
      source: string | null;
      cacheHit: boolean;
      createdAt: Date;
      requestedBy: ResolvedRequestedBy | null;
    }> = [];
    if (source === 'vehicle_history_reports') {
      const reqRows = await this.prisma.vehicleHistoryRequest.findMany({
        where: { reportId: id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, source: true, cacheHit: true, createdAt: true, requestedBy: true, tenantId: true },
      });
      const resolver = await this.buildRequestedByResolver(reqRows);
      requests = reqRows.map((r) => ({
        id: r.id,
        status: r.status,
        source: r.source,
        cacheHit: r.cacheHit,
        createdAt: r.createdAt,
        requestedBy: resolver(r.requestedBy, r.tenantId),
      }));
    }

    const { extraction, extractionLogs } = await this.extractions.getForSource(source, id);

    return {
      report,
      parsed: parsed
        ? {
            ...parsed,
            confidence: Number(parsed.confidence),
            flags: {
              brandedTitle: parsed.brandedTitle,
              totalLoss: parsed.totalLoss,
              salvage: parsed.salvage,
              flood: parsed.flood,
              structuralDamage: parsed.structuralDamage,
              airbagDeployed: parsed.airbagDeployed,
              odometerRollbackSuspected: parsed.odometerRollbackSuspected,
            },
          }
        : null,
      requests,
      extraction,
      extractionLogs,
    };
  }

  async getFile(source: string, id: string) {
    this.assertSource(source);
    if (source === 'carfax_reports') {
      const row = await this.prisma.carfaxReport.findUnique({ where: { id }, select: { s3Key: true } });
      if (!row) throw new NotFoundException('Report not found');
      const parsed = await this.prisma.vehicleHistoryParsed.findUnique({ where: { s3Key: row.s3Key }, select: { template: true } });
      const contentType = this.carfaxContentType(row.s3Key, parsed?.template ?? null);
      return this.sign(row.s3Key, contentType);
    }
    const row = await this.prisma.vehicleHistoryReport.findUnique({ where: { id }, select: { s3Key: true, contentType: true } });
    if (!row) throw new NotFoundException('Report not found');
    return this.sign(row.s3Key, row.contentType);
  }

  private async sign(s3Key: string, contentType: string) {
    const ttlSeconds = 600;
    const url = await this.s3.getSignedUrl(s3Key, ttlSeconds, {
      contentType: contentType === 'text/html' ? 'text/html; charset=utf-8' : contentType,
      disposition: 'inline',
    });
    return { url, contentType, expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString() };
  }

  private carfaxContentType(s3Key: string, template: string | null): string {
    if (/\.pdf$/i.test(s3Key)) return 'application/pdf';
    if (/\.html?$/i.test(s3Key)) return 'text/html';
    if (template && template.toLowerCase().includes('pdf')) return 'application/pdf';
    return 'text/html';
  }

  private assertSource(source: string): source is LibrarySource {
    if (!LIBRARY_SOURCES.includes(source as LibrarySource)) throw new NotFoundException('Unknown report source');
    return true;
  }

  private async hydrate(rows: LibraryRow[]) {
    const resolver = await this.buildRequestedByResolver(rows);
    const extractionMap = await this.extractions.getForSources(rows.map((r) => ({ sourceTable: r.source, sourceId: r.id })));
    return rows.map((r) => ({
      source: r.source,
      id: r.id,
      vin: r.vin,
      reportType: r.reportType,
      providerKey: r.providerKey,
      contentType: r.contentType,
      yearMakeModel: r.yearMakeModel,
      auctionListingId: r.auctionListingId,
      createdAt: r.createdAt.toISOString(),
      reportDate: r.reportDate ? r.reportDate.toISOString() : null,
      origin: r.origin,
      requestedBy: resolver(r.requestedBy, r.tenantId),
      parse: r.parseStatus
        ? {
            status: r.parseStatus,
            confidence: Number(r.confidence),
            template: r.template,
            llmUsed: !!r.llmUsed,
            accidentCount: r.accidentCount,
            ownerCount: r.ownerCount,
            lastOdometer: r.lastOdometer,
            flags: {
              brandedTitle: r.brandedTitle,
              totalLoss: r.totalLoss,
              salvage: r.salvage,
              flood: r.flood,
              structuralDamage: r.structuralDamage,
              airbagDeployed: r.airbagDeployed,
              odometerRollbackSuspected: r.odometerRollbackSuspected,
            },
          }
        : null,
      extraction: extractionMap.get(`${r.source}:${r.id}`) ?? null,
    }));
  }

  /** Batch-resolves requestedBy ('api-key:<id>' | user id | null) + tenantId into { kind, id, name, tenantName }. */
  private async buildRequestedByResolver(entries: RequestedByRef[]) {
    const userIds = new Set<string>();
    const apiKeyIds = new Set<string>();
    const tenantIds = new Set<string>();
    for (const e of entries) {
      if (e.tenantId) tenantIds.add(e.tenantId);
      if (!e.requestedBy) continue;
      if (e.requestedBy.startsWith('api-key:')) apiKeyIds.add(e.requestedBy.slice('api-key:'.length));
      else userIds.add(e.requestedBy);
    }

    const [users, apiKeys] = await Promise.all([
      userIds.size
        ? this.prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, firstName: true, lastName: true, email: true } })
        : Promise.resolve([] as { id: string; firstName: string | null; lastName: string | null; email: string }[]),
      apiKeyIds.size
        ? this.prisma.apiKey.findMany({ where: { id: { in: [...apiKeyIds] } }, select: { id: true, name: true, tenantId: true } })
        : Promise.resolve([] as { id: string; name: string; tenantId: string }[]),
    ]);
    for (const k of apiKeys) if (k.tenantId) tenantIds.add(k.tenantId);

    const tenants = tenantIds.size ? await this.prisma.tenant.findMany({ where: { id: { in: [...tenantIds] } }, select: { id: true, name: true } }) : [];

    const userMap = new Map(users.map((u) => [u.id, u]));
    const apiKeyMap = new Map(apiKeys.map((k) => [k.id, k]));
    const tenantMap = new Map(tenants.map((t) => [t.id, t.name]));

    return (requestedBy: string | null, tenantId: string | null): ResolvedRequestedBy | null => {
      if (!requestedBy) return null;
      if (requestedBy.startsWith('api-key:')) {
        const id = requestedBy.slice('api-key:'.length);
        const key = apiKeyMap.get(id);
        const effectiveTenantId = tenantId ?? key?.tenantId ?? null;
        return { kind: 'api-key', id, name: key?.name ?? null, tenantName: effectiveTenantId ? tenantMap.get(effectiveTenantId) ?? null : null };
      }
      const user = userMap.get(requestedBy);
      if (user) {
        const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email;
        return { kind: 'user', id: requestedBy, name, tenantName: tenantId ? tenantMap.get(tenantId) ?? null : null };
      }
      return { kind: 'system', id: requestedBy, name: null, tenantName: tenantId ? tenantMap.get(tenantId) ?? null : null };
    };
  }
}
