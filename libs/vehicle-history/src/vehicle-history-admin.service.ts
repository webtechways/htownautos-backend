import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { ADAPTERS, ADAPTER_BY_KEY } from './providers';
import { AttemptEntry, VehicleHistoryService } from './vehicle-history.service';

export interface ProviderUpdate {
  enabled?: boolean;
  carfaxEnabled?: boolean;
  autocheckEnabled?: boolean;
  timeoutMs?: number;
  /** '' resets to the adapter default. */
  baseUrl?: string;
  /** '' removes the key set from the UI (the env var applies again). */
  apiKey?: string;
}

export interface SettingsUpdate {
  cacheDays?: number;
  circuitFailureThreshold?: number;
  circuitCooldownMinutes?: number;
  healthCheckMinutes?: number;
  logRetentionDays?: number;
}

interface KindAgg { providerKey: string; kind: string; total: number; ok: number; avg_ms: number | null; p95_ms: number | null; last_at: Date }
interface RouteAgg extends KindAgg { method: string; route: string; last_status: number | null; last_error: string | null }
interface ErrorAgg { providerKey: string; errorCode: string | null; total: number }

const pct = (part: number, total: number) => (total ? Math.round((part / total) * 1000) / 10 : null);

/** Settings → Vehicle History: provider order and toggles, keys, health, logs and stats. */
@Injectable()
export class VehicleHistoryAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly history: VehicleHistoryService,
  ) {}

  async listProviders() {
    await this.history.ensureProviders();
    const rows = await this.prisma.vehicleHistoryProvider.findMany({ orderBy: [{ priority: 'asc' }, { key: 'asc' }] });
    const now = Date.now();
    return rows
      .filter((r) => ADAPTER_BY_KEY.has(r.key))
      .map((r) => {
        const a = ADAPTER_BY_KEY.get(r.key)!;
        const { key, source } = this.history.resolveApiKey(r, a);
        const { encryptedApiKey: _secret, ...row } = r;
        return {
          ...row,
          name: a.name,
          website: a.website,
          turnaround: a.turnaround,
          supports: a.supports,
          routes: a.routes,
          envApiKey: a.envApiKey,
          defaultBaseUrl: a.defaultBaseUrl,
          effectiveBaseUrl: r.baseUrl?.trim() || a.defaultBaseUrl,
          apiKeySource: source,
          apiKeyHint: key ? `••••${key.slice(-4)}` : null,
          circuitOpen: !!r.circuitOpenUntil && r.circuitOpenUntil.getTime() > now,
        };
      });
  }

  async updateProvider(key: string, dto: ProviderUpdate) {
    if (!ADAPTER_BY_KEY.has(key)) throw new NotFoundException('Unknown provider');
    const data: Prisma.VehicleHistoryProviderUpdateInput = {};
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.carfaxEnabled !== undefined) data.carfaxEnabled = dto.carfaxEnabled;
    if (dto.autocheckEnabled !== undefined) data.autocheckEnabled = dto.autocheckEnabled;
    if (dto.timeoutMs !== undefined) data.timeoutMs = dto.timeoutMs;
    if (dto.baseUrl !== undefined) {
      const url = dto.baseUrl.trim();
      if (url && !/^https:\/\/[^\s]+$/i.test(url)) throw new BadRequestException('Base URL must start with https://');
      data.baseUrl = url ? url.replace(/\/+$/, '') : null;
    }
    if (dto.apiKey !== undefined) {
      const k = dto.apiKey.trim();
      data.encryptedApiKey = k ? this.history.encryptApiKey(k) : null;
    }
    await this.prisma.vehicleHistoryProvider.update({ where: { key }, data });
    // A new key deserves a fresh health reading.
    if (dto.apiKey !== undefined || dto.baseUrl !== undefined) await this.history.checkHealth(key).catch(() => null);
    return this.listProviders();
  }

  /** Sets the fallback order: first key runs first. */
  async reorder(keys: string[]) {
    const unique = [...new Set(keys)];
    if (unique.some((k) => !ADAPTER_BY_KEY.has(k))) throw new BadRequestException('Unknown provider in the order');
    const rest = ADAPTERS.map((a) => a.key).filter((k) => !unique.includes(k));
    await this.prisma.$transaction(
      [...unique, ...rest].map((key, i) => this.prisma.vehicleHistoryProvider.update({ where: { key }, data: { priority: (i + 1) * 10 } })),
    );
    return this.listProviders();
  }

  async resetCircuit(key: string) {
    if (!ADAPTER_BY_KEY.has(key)) throw new NotFoundException('Unknown provider');
    await this.prisma.vehicleHistoryProvider.update({ where: { key }, data: { consecutiveFailures: 0, circuitOpenUntil: null } });
    return this.listProviders();
  }

  getSettings() {
    return this.history.getSettings();
  }

  async updateSettings(dto: SettingsUpdate) {
    await this.history.getSettings();
    return this.prisma.vehicleHistorySettings.update({ where: { id: 'singleton' }, data: { ...dto } });
  }

  // ── History & log ───────────────────────────────────────────────────────

  async listRequests(q: { page?: number; limit?: number; status?: string; providerKey?: string; vin?: string; type?: string }) {
    const page = Math.max(1, q.page || 1);
    const limit = Math.min(100, Math.max(1, q.limit || 25));
    const where: Prisma.VehicleHistoryRequestWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.providerKey ? { providerKey: q.providerKey } : {}),
      ...(q.type ? { reportType: q.type } : {}),
      ...(q.vin ? { vin: { contains: q.vin.toUpperCase().trim() } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.vehicleHistoryRequest.count({ where }),
      this.prisma.vehicleHistoryRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { report: { select: { id: true, s3Key: true, contentType: true, yearMakeModel: true } }, _count: { select: { calls: true } } },
      }),
    ]);
    return {
      data: rows.map(({ _count, ...r }) => ({ ...r, auctionListingId: r.auctionListingId?.toString() ?? null, callCount: _count.calls })),
      total,
      page,
      limit,
    };
  }

  async listCalls(q: { page?: number; limit?: number; providerKey?: string; kind?: string; ok?: string; requestId?: string }) {
    const page = Math.max(1, q.page || 1);
    const limit = Math.min(200, Math.max(1, q.limit || 50));
    const where: Prisma.VehicleHistoryCallWhereInput = {
      ...(q.providerKey ? { providerKey: q.providerKey } : {}),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.ok === 'true' ? { ok: true } : q.ok === 'false' ? { ok: false } : {}),
      ...(q.requestId ? { requestId: q.requestId } : {}),
    };
    const [total, data] = await Promise.all([
      this.prisma.vehicleHistoryCall.count({ where }),
      this.prisma.vehicleHistoryCall.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    ]);
    return { data, total, page, limit };
  }

  // ── Stats ───────────────────────────────────────────────────────────────

  async stats(days: number) {
    const span = Math.min(365, Math.max(1, Math.round(days) || 7));
    const since = new Date(Date.now() - span * 86_400_000);

    const [kindRows, routeRows, errorRows, requests] = await Promise.all([
      this.prisma.$queryRaw`
        SELECT "providerKey", kind, count(*)::int AS total, count(*) FILTER (WHERE ok)::int AS ok,
               round(avg("durationMs"))::int AS avg_ms,
               round(percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs"))::int AS p95_ms,
               max("createdAt") AS last_at
        FROM vehicle_history_calls WHERE "createdAt" >= ${since}
        GROUP BY 1, 2`,
      this.prisma.$queryRaw`
        SELECT "providerKey", kind, method, route, count(*)::int AS total, count(*) FILTER (WHERE ok)::int AS ok,
               round(avg("durationMs"))::int AS avg_ms,
               round(percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs"))::int AS p95_ms,
               max("createdAt") AS last_at,
               (array_agg("httpStatus" ORDER BY "createdAt" DESC))[1] AS last_status,
               (array_agg("errorCode" ORDER BY "createdAt" DESC) FILTER (WHERE NOT ok))[1] AS last_error
        FROM vehicle_history_calls WHERE "createdAt" >= ${since}
        GROUP BY 1, 2, 3, 4 ORDER BY 1, total DESC`,
      this.prisma.$queryRaw`
        SELECT "providerKey", "errorCode", count(*)::int AS total
        FROM vehicle_history_calls WHERE "createdAt" >= ${since} AND NOT ok
        GROUP BY 1, 2 ORDER BY total DESC`,
      this.prisma.vehicleHistoryRequest.findMany({
        where: { createdAt: { gte: since } },
        select: { status: true, reportType: true, providerKey: true, cacheHit: true, durationMs: true, attemptLog: true, createdAt: true, errorCode: true },
        take: 20_000,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const byProvider = kindRows as KindAgg[];
    const byRoute = routeRows as RouteAgg[];
    const byError = errorRows as ErrorAgg[];

    // Requests: outcome, fallbacks that saved the day, and who served what.
    const totals = { total: requests.length, completed: 0, failed: 0, running: 0, cacheHits: 0, rescuedByFallback: 0, avgMs: null as number | null };
    const served = new Map<string, { carfax: number; autocheck: number; firstChoice: number; asFallback: number; durations: number[] }>();
    const failures = new Map<string, number>();
    const daily = new Map<string, { date: string; completed: number; failed: number; cacheHits: number }>();
    const durations: number[] = [];
    for (const r of requests) {
      const day = r.createdAt.toISOString().slice(0, 10);
      const d = daily.get(day) ?? { date: day, completed: 0, failed: 0, cacheHits: 0 };
      daily.set(day, d);
      if (r.status === 'running') { totals.running++; continue; }
      if (r.status === 'failed') {
        totals.failed++;
        d.failed++;
        failures.set(r.errorCode ?? 'unknown', (failures.get(r.errorCode ?? 'unknown') ?? 0) + 1);
        continue;
      }
      totals.completed++;
      d.completed++;
      if (r.cacheHit) { totals.cacheHits++; d.cacheHits++; continue; }
      if (r.durationMs != null) durations.push(r.durationMs);
      const attempts = (r.attemptLog as unknown as AttemptEntry[]) ?? [];
      const rescued = attempts.some((a) => a.outcome === 'failed');
      if (rescued) totals.rescuedByFallback++;
      if (r.providerKey) {
        const s = served.get(r.providerKey) ?? { carfax: 0, autocheck: 0, firstChoice: 0, asFallback: 0, durations: [] };
        if (r.reportType === 'autocheck') s.autocheck++;
        else s.carfax++;
        if (rescued) s.asFallback++;
        else s.firstChoice++;
        if (r.durationMs != null) s.durations.push(r.durationMs);
        served.set(r.providerKey, s);
      }
    }
    totals.avgMs = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

    const providers = ADAPTERS.map((a) => {
      const kinds = byProvider.filter((p) => p.providerKey === a.key);
      const reportKinds = kinds.filter((k) => k.kind !== 'health');
      const calls = kinds.reduce((n, k) => n + k.total, 0);
      const ok = kinds.reduce((n, k) => n + k.ok, 0);
      const s = served.get(a.key);
      const health = kinds.find((k) => k.kind === 'health');
      return {
        key: a.key,
        name: a.name,
        calls,
        okCalls: ok,
        successRate: pct(ok, calls),
        reportCalls: reportKinds.reduce((n, k) => n + k.total, 0),
        reportCallSuccessRate: pct(reportKinds.reduce((n, k) => n + k.ok, 0), reportKinds.reduce((n, k) => n + k.total, 0)),
        healthChecks: health?.total ?? 0,
        healthSuccessRate: health ? pct(health.ok, health.total) : null,
        served: { carfax: s?.carfax ?? 0, autocheck: s?.autocheck ?? 0, firstChoice: s?.firstChoice ?? 0, asFallback: s?.asFallback ?? 0 },
        avgReportMs: s?.durations.length ? Math.round(s.durations.reduce((x, y) => x + y, 0) / s.durations.length) : null,
        lastCallAt: kinds.reduce<Date | null>((m, k) => (!m || k.last_at > m ? k.last_at : m), null),
        errors: byError.filter((e) => e.providerKey === a.key).map((e) => ({ code: e.errorCode ?? 'unknown', count: e.total })),
      };
    });

    return {
      days: span,
      since,
      requests: { ...totals, successRate: pct(totals.completed, totals.completed + totals.failed), failures: [...failures].map(([code, count]) => ({ code, count })) },
      providers,
      routes: byRoute.map((r) => ({ ...r, successRate: pct(r.ok, r.total) })),
      daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    };
  }
}
