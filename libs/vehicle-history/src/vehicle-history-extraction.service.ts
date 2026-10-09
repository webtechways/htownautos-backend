import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { RabbitMQService, VEHICLE_HISTORY_EXTRACT_QUEUE } from '@htownautos/rabbitmq';
import { PROMPT_VERSION } from './extract/prompt';
import { ExtractionLogsQueryDto, ReprocessBulkDto } from './dto';
import { LibrarySource } from './vehicle-history-library.service';

const LIBRARY_SOURCES: LibrarySource[] = ['carfax_reports', 'vehicle_history_reports'];

export interface ExtractionSummaryDto {
  id: string;
  s3Key: string;
  vin: string | null;
  status: 'ok' | 'failed' | 'not_report';
  model: string;
  promptVersion: number;
  extractedAt: string;
  costUsdTotal: number;
  report: unknown | null;
  error: string | null;
}

export interface ExtractionLogDto {
  id: string;
  createdAt: string;
  s3Key: string;
  vin: string | null;
  sourceTable: string;
  sourceId: string;
  trigger: string;
  triggeredBy: { id: string; name: string } | null;
  model: string;
  promptVersion: number;
  inputMode: string;
  inputChars: number | null;
  promptTokens: number | null;
  cachedTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  attempt: number;
  status: string;
  error: string | null;
}

interface ExtractionRow {
  id: string;
  s3Key: string;
  vin: string;
  status: string;
  model: string;
  promptVersion: number;
  data: unknown;
  costUsdTotal: Prisma.Decimal;
  error: string | null;
  extractedAt: Date;
}

interface LogRow {
  id: string;
  createdAt: Date;
  s3Key: string;
  vin: string;
  sourceTable: string;
  sourceId: string;
  trigger: string;
  triggeredByUserId: string | null;
  model: string;
  promptVersion: number;
  inputMode: string;
  inputChars: number | null;
  promptTokens: number | null;
  cachedTokens: number | null;
  completionTokens: number | null;
  costUsd: Prisma.Decimal | null;
  latencyMs: number | null;
  attempt: number;
  status: string;
  error: string | null;
}

/**
 * OpenAI structured-output extraction: logs/totals/reprocess around
 * `VehicleHistoryExtraction` + `VehicleHistoryExtractionLog`. Separate from
 * `VehicleHistoryLibraryService` (the deterministic parser) — both hang off
 * the same report tables via `s3Key`/`(sourceTable, sourceId)`.
 */
@Injectable()
export class VehicleHistoryExtractionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitMQ: RabbitMQService,
  ) {}

  toSummary(row: ExtractionRow): ExtractionSummaryDto {
    return {
      id: row.id,
      s3Key: row.s3Key,
      vin: row.vin,
      status: row.status as ExtractionSummaryDto['status'],
      model: row.model,
      promptVersion: row.promptVersion,
      extractedAt: row.extractedAt.toISOString(),
      costUsdTotal: Number(row.costUsdTotal),
      report: row.data ?? null,
      error: row.error,
    };
  }

  /** Used by VehicleHistoryLibraryService.getOne — single extraction + its last 20 logs. */
  async getForSource(sourceTable: string, sourceId: string): Promise<{ extraction: ExtractionSummaryDto | null; extractionLogs: ExtractionLogDto[] }> {
    const extraction = await this.prisma.vehicleHistoryExtraction.findFirst({ where: { sourceTable, sourceId } });
    const logRows = await this.prisma.vehicleHistoryExtractionLog.findMany({
      where: { sourceTable, sourceId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const extractionLogs = await this.hydrateLogs(logRows as LogRow[]);
    return { extraction: extraction ? this.toSummary(extraction as ExtractionRow) : null, extractionLogs };
  }

  /** Used by VehicleHistoryLibraryService.hydrate — per-row summary for the list view. */
  async getForSources(
    refs: Array<{ sourceTable: string; sourceId: string }>,
  ): Promise<Map<string, { status: string; title: unknown; accident: boolean | null; millage: number | null; costUsdTotal: number }>> {
    const map = new Map<string, { status: string; title: unknown; accident: boolean | null; millage: number | null; costUsdTotal: number }>();
    if (refs.length === 0) return map;
    const bySourceTable = new Map<string, string[]>();
    for (const r of refs) {
      if (!bySourceTable.has(r.sourceTable)) bySourceTable.set(r.sourceTable, []);
      bySourceTable.get(r.sourceTable)!.push(r.sourceId);
    }
    const rows = await this.prisma.vehicleHistoryExtraction.findMany({
      where: { OR: [...bySourceTable.entries()].map(([sourceTable, sourceIds]) => ({ sourceTable, sourceId: { in: sourceIds } })) },
      select: { sourceTable: true, sourceId: true, status: true, title: true, accident: true, mileage: true, costUsdTotal: true },
    });
    for (const row of rows) {
      map.set(`${row.sourceTable}:${row.sourceId}`, {
        status: row.status,
        title: row.title,
        accident: row.accident,
        millage: row.mileage,
        costUsdTotal: Number(row.costUsdTotal),
      });
    }
    return map;
  }

  async listLogs(q: ExtractionLogsQueryDto): Promise<{
    items: ExtractionLogDto[];
    total: number;
    page: number;
    pageSize: number;
    totals: {
      todayUsd: number;
      monthUsd: number;
      allTimeUsd: number;
      todayCount: number;
      monthCount: number;
      failedToday: number;
      dailyBudgetUsd: number;
    };
  }> {
    const page = Math.max(1, q.page || 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize || 50));

    const where: Prisma.VehicleHistoryExtractionLogWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.trigger) where.trigger = q.trigger;
    if (q.model) where.model = q.model;
    if (q.vin) where.vin = { contains: q.vin.toUpperCase().trim(), mode: 'insensitive' };
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) where.createdAt.gte = new Date(q.from);
      if (q.to) where.createdAt.lte = new Date(q.to);
    }

    const [rows, total, totals] = await Promise.all([
      this.prisma.vehicleHistoryExtractionLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.vehicleHistoryExtractionLog.count({ where }),
      this.computeTotals(),
    ]);

    const items = await this.hydrateLogs(rows as LogRow[]);
    return { items, total, page, pageSize, totals };
  }

  /** Reuses the Chicago-day bucketing from the consumer's budget check (see vh-extract-extract-patterns memory). */
  private async computeTotals() {
    const dailyBudgetUsd = Number(process.env.VH_EXTRACT_DAILY_BUDGET_USD || '3');
    const rows = (await this.prisma.$queryRaw(Prisma.sql`
      SELECT
        COALESCE(SUM("costUsd") FILTER (WHERE ("createdAt" AT TIME ZONE 'America/Chicago')::date = (now() AT TIME ZONE 'America/Chicago')::date), 0) AS "todayUsd",
        COUNT(*) FILTER (WHERE ("createdAt" AT TIME ZONE 'America/Chicago')::date = (now() AT TIME ZONE 'America/Chicago')::date) AS "todayCount",
        COUNT(*) FILTER (
          WHERE ("createdAt" AT TIME ZONE 'America/Chicago')::date = (now() AT TIME ZONE 'America/Chicago')::date
            AND status NOT IN ('ok', 'not_report', 'skipped')
        ) AS "failedToday",
        COALESCE(SUM("costUsd") FILTER (
          WHERE date_trunc('month', "createdAt" AT TIME ZONE 'America/Chicago') = date_trunc('month', now() AT TIME ZONE 'America/Chicago')
        ), 0) AS "monthUsd",
        COUNT(*) FILTER (
          WHERE date_trunc('month', "createdAt" AT TIME ZONE 'America/Chicago') = date_trunc('month', now() AT TIME ZONE 'America/Chicago')
        ) AS "monthCount",
        COALESCE(SUM("costUsd"), 0) AS "allTimeUsd"
      FROM "vehicle_history_extraction_logs"
    `)) as {
      todayUsd: string | number;
      todayCount: bigint | number;
      failedToday: bigint | number;
      monthUsd: string | number;
      monthCount: bigint | number;
      allTimeUsd: string | number;
    }[];
    const r = rows[0];
    return {
      todayUsd: Number(r?.todayUsd ?? 0),
      monthUsd: Number(r?.monthUsd ?? 0),
      allTimeUsd: Number(r?.allTimeUsd ?? 0),
      todayCount: Number(r?.todayCount ?? 0),
      monthCount: Number(r?.monthCount ?? 0),
      failedToday: Number(r?.failedToday ?? 0),
      dailyBudgetUsd,
    };
  }

  private async hydrateLogs(rows: LogRow[]): Promise<ExtractionLogDto[]> {
    const userIds = [...new Set(rows.map((r) => r.triggeredByUserId).filter((v): v is string => !!v))];
    const users = userIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, email: true } })
      : [];
    const userMap = new Map(users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email]));

    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      s3Key: r.s3Key,
      vin: r.vin || null,
      sourceTable: r.sourceTable,
      sourceId: r.sourceId,
      trigger: r.trigger,
      triggeredBy: r.triggeredByUserId ? { id: r.triggeredByUserId, name: userMap.get(r.triggeredByUserId) ?? r.triggeredByUserId } : null,
      model: r.model,
      promptVersion: r.promptVersion,
      inputMode: r.inputMode,
      inputChars: r.inputChars,
      promptTokens: r.promptTokens,
      cachedTokens: r.cachedTokens,
      completionTokens: r.completionTokens,
      costUsd: r.costUsd !== null ? Number(r.costUsd) : null,
      latencyMs: r.latencyMs,
      attempt: r.attempt,
      status: r.status,
      error: r.error,
    }));
  }

  async reprocessOne(source: string, id: string, requestedByUserId: string | null): Promise<{ queued: true; s3Key: string }> {
    const s3Key = await this.resolveS3Key(source, id);
    await this.rabbitMQ.publish(VEHICLE_HISTORY_EXTRACT_QUEUE, {
      s3Key,
      trigger: 'manual',
      requestedByUserId: requestedByUserId ?? undefined,
      force: true,
    });
    return { queued: true, s3Key };
  }

  async reprocessBulk(dto: ReprocessBulkDto, requestedByUserId: string | null): Promise<{ queued: number }> {
    const s3Keys = await this.selectBulkTargets(dto.scope, dto.limit);
    let queued = 0;
    for (const s3Key of s3Keys) {
      const ok = await this.rabbitMQ.publish(VEHICLE_HISTORY_EXTRACT_QUEUE, {
        s3Key,
        trigger: 'bulk',
        requestedByUserId: requestedByUserId ?? undefined,
        force: true,
      });
      if (ok) queued++;
    }
    return { queued };
  }

  private async selectBulkTargets(scope: 'failed' | 'outdated' | 'all', limit: number): Promise<string[]> {
    if (scope === 'failed') {
      const rows = await this.prisma.vehicleHistoryExtraction.findMany({
        where: { status: 'failed' },
        select: { s3Key: true },
        take: limit,
        orderBy: { updatedAt: 'desc' },
      });
      return rows.map((r) => r.s3Key);
    }
    if (scope === 'outdated') {
      const rows = (await this.prisma.$queryRaw(Prisma.sql`
        SELECT s."s3Key" FROM (
          SELECT "s3Key" FROM "carfax_reports"
          UNION
          SELECT "s3Key" FROM "vehicle_history_reports"
        ) s
        LEFT JOIN "vehicle_history_extractions" e ON e."s3Key" = s."s3Key"
        WHERE e.id IS NULL OR e."promptVersion" < ${PROMPT_VERSION}
        LIMIT ${limit}
      `)) as { s3Key: string }[];
      return rows.map((r) => r.s3Key);
    }
    const rows = (await this.prisma.$queryRaw(Prisma.sql`
      SELECT "s3Key" FROM "carfax_reports"
      UNION
      SELECT "s3Key" FROM "vehicle_history_reports"
      LIMIT ${limit}
    `)) as { s3Key: string }[];
    return rows.map((r) => r.s3Key);
  }

  private async resolveS3Key(source: string, id: string): Promise<string> {
    if (!LIBRARY_SOURCES.includes(source as LibrarySource)) throw new NotFoundException('Unknown report source');
    if (source === 'carfax_reports') {
      const row = await this.prisma.carfaxReport.findUnique({ where: { id }, select: { s3Key: true } });
      if (!row) throw new NotFoundException('Report not found');
      return row.s3Key;
    }
    const row = await this.prisma.vehicleHistoryReport.findUnique({ where: { id }, select: { s3Key: true } });
    if (!row) throw new NotFoundException('Report not found');
    return row.s3Key;
  }

  /** v2 `GET /vehicle-history/extraction/:vin` — latest `ok` extraction for a VIN, frozen CONTRACT shape. */
  async getExtractionForVin(vin: string): Promise<{ vin: string; extractedAt: string; model: string; promptVersion: number; report: unknown } | null> {
    const row = await this.prisma.vehicleHistoryExtraction.findFirst({
      where: { vin: vin.toUpperCase().trim(), status: 'ok' },
      orderBy: { extractedAt: 'desc' },
    });
    if (!row) return null;
    return { vin: row.vin, extractedAt: row.extractedAt.toISOString(), model: row.model, promptVersion: row.promptVersion, report: row.data ?? null };
  }
}
