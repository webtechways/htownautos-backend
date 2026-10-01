import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { S3Service } from '@htownautos/common';
import { decryptSecret, encryptSecret } from '@htownautos/social';
import { ADAPTERS, ADAPTER_BY_KEY } from './providers';
import { createContext } from './provider-http';
import { CallEntry, ProviderError, ReportType, REPORT_TYPES, VehicleHistoryAdapter } from './types';

type ProviderRow = Prisma.VehicleHistoryProviderGetPayload<object>;
type SettingsRow = Prisma.VehicleHistorySettingsGetPayload<object>;

/** How one provider fared within a request (stored in attemptLog). */
export interface AttemptEntry {
  providerKey: string;
  /** success | failed | skipped */
  outcome: 'success' | 'failed' | 'skipped';
  /** For skipped: disabled | type_disabled | unsupported | unconfigured. */
  reason?: string;
  errorCode?: string | null;
  message?: string | null;
  durationMs?: number;
  /** It was behind an open circuit and only tried after the healthy ones. */
  deferred?: boolean;
  /** Delivered by the background check after the time budget ran out. */
  late?: boolean;
}

export interface OrderInput {
  vin: string;
  type: ReportType;
  /** Skip the cache and order a new report. */
  force?: boolean;
  source?: string;
  auctionListingId?: string | bigint | null;
  requestedBy?: string | null;
  tenantId?: string | null;
  /** Admin test: use only this provider (ignores its toggles and circuit). */
  onlyProvider?: string;
}

export interface RequestView {
  id: string;
  vin: string;
  reportType: ReportType;
  status: 'running' | 'completed' | 'failed';
  source: string | null;
  cacheHit: boolean;
  forced: boolean;
  providerKey: string | null;
  providerName: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: AttemptEntry[];
  durationMs: number | null;
  createdAt: Date;
  completedAt: Date | null;
  report: {
    id: string;
    s3Key: string;
    contentType: string;
    yearMakeModel: string | null;
    providerKey: string;
    createdAt: Date;
    url: string;
  } | null;
}

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
/** A request still "running" after this long was cut off (deploy/restart). */
const STALE_MS = 45 * 60_000;
/** How long a timed-out (paid) provider job keeps being checked in the background. */
const RESUME_WINDOW_MS = 6 * 3600_000;
const HEALTH_BUDGET_MS = 20_000;

const ERROR_TEXT: Record<string, string> = {
  not_found: 'None of the providers has a report for this VIN',
  no_providers: 'No provider is enabled and configured for this report type',
  all_failed: 'Every provider failed; see the attempts',
  interrupted: 'The request was interrupted (server restart); order it again',
};

export function normalizeVin(raw: string): string {
  return (raw ?? '').toUpperCase().replace(/[\s-]/g, '');
}

/**
 * Orders Carfax / AutoCheck reports through the configured providers, in
 * priority order, falling back to the next one when a provider is down, out of
 * credits or has nothing for the VIN. Reports are kept in S3 and reused for the
 * same VIN + type within the cache window, so a fallback chain never pays twice.
 */
@Injectable()
export class VehicleHistoryService implements OnModuleInit {
  private readonly logger = new Logger(VehicleHistoryService.name);
  /** In-flight requests in this process, by request id. */
  private readonly running = new Map<string, Promise<void>>();
  /** vin:type → id of the request ordering it, so a double click doesn't buy the report twice. */
  private readonly inflight = new Map<string, Promise<string>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

  async onModuleInit() {
    try {
      await this.ensureProviders();
    } catch (err) {
      this.logger.warn(`Could not seed providers: ${(err as Error).message}`);
    }
  }

  // ── Config ──────────────────────────────────────────────────────────────

  /** Gives every registered adapter a row; new ones go to the end of the line. */
  async ensureProviders(): Promise<void> {
    const rows = await this.prisma.vehicleHistoryProvider.findMany({ select: { key: true, priority: true } });
    const known = new Set(rows.map((r) => r.key));
    let next = rows.reduce((m, r) => Math.max(m, r.priority), 0);
    const missing = ADAPTERS.filter((a) => !known.has(a.key));
    if (!missing.length) return;
    await this.prisma.vehicleHistoryProvider.createMany({
      data: missing.map((a) => ({ key: a.key, priority: (next += 10), timeoutMs: a.defaultTimeoutMs })),
      skipDuplicates: true,
    });
  }

  async getSettings(): Promise<SettingsRow> {
    return this.prisma.vehicleHistorySettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } });
  }

  /** The key set from the UI, else the adapter's env var. */
  resolveApiKey(row: ProviderRow, adapter: VehicleHistoryAdapter): { key: string; source: 'ui' | 'env' | 'none' } {
    if (row.encryptedApiKey) {
      try {
        const key = decryptSecret(row.encryptedApiKey);
        if (key) return { key, source: 'ui' };
      } catch (err) {
        this.logger.error(`Cannot decrypt the ${row.key} API key: ${(err as Error).message}`);
      }
    }
    const env = process.env[adapter.envApiKey]?.trim();
    return env ? { key: env, source: 'env' } : { key: '', source: 'none' };
  }

  encryptApiKey(plain: string): string {
    try {
      return encryptSecret(plain);
    } catch (err) {
      throw new BadRequestException(`The API key can't be stored: ${(err as Error).message}`);
    }
  }

  private baseUrl(row: ProviderRow, adapter: VehicleHistoryAdapter): string {
    return row.baseUrl?.trim() || adapter.defaultBaseUrl;
  }

  // ── Ordering ────────────────────────────────────────────────────────────

  /**
   * Orders a report. Returns at once on a cache hit; otherwise starts the
   * provider chain in the background and waits up to `waitMs` for it — a
   * still-running request comes back with status "running" to poll by id.
   */
  async order(input: OrderInput, waitMs = 0): Promise<RequestView> {
    const vin = normalizeVin(input.vin);
    if (!VIN_RE.test(vin)) throw new BadRequestException('VIN must be 17 characters (no I, O or Q)');
    if (!REPORT_TYPES.includes(input.type)) throw new BadRequestException(`type must be one of: ${REPORT_TYPES.join(', ')}`);
    if (input.onlyProvider && !ADAPTER_BY_KEY.has(input.onlyProvider)) throw new NotFoundException('Unknown provider');

    const flightKey = `${vin}:${input.type}`;
    const listingId = input.auctionListingId != null && input.auctionListingId !== '' ? BigInt(input.auctionListingId) : null;
    const base = {
      vin,
      reportType: input.type,
      source: input.source ?? null,
      auctionListingId: listingId,
      requestedBy: input.requestedBy ?? null,
      tenantId: input.tenantId ?? null,
      forced: !!input.force,
    };

    // Same VIN + type already being ordered: join it instead of paying twice.
    // The marker is set before the first await so simultaneous clicks see it.
    if (!input.onlyProvider) {
      const existing = this.inflight.get(flightKey);
      if (existing) return this.waitAndView(await existing, waitMs);
    }
    let resolveId!: (id: string) => void;
    let rejectId!: (err: unknown) => void;
    const idPromise = new Promise<string>((res, rej) => {
      resolveId = res;
      rejectId = rej;
    });
    idPromise.catch(() => undefined);
    const release = () => {
      if (this.inflight.get(flightKey) === idPromise) this.inflight.delete(flightKey);
    };
    if (!input.onlyProvider) this.inflight.set(flightKey, idPromise);

    try {
      if (!input.force && !input.onlyProvider) {
        const settings = await this.getSettings();
        if (settings.cacheDays > 0) {
          const cached = await this.prisma.vehicleHistoryReport.findFirst({
            where: { vin, reportType: input.type, createdAt: { gte: new Date(Date.now() - settings.cacheDays * 86_400_000) } },
            orderBy: { createdAt: 'desc' },
          });
          if (cached) {
            const row = await this.prisma.vehicleHistoryRequest.create({
              data: { ...base, status: 'completed', cacheHit: true, reportId: cached.id, providerKey: cached.providerKey, attemptLog: [], durationMs: 0, completedAt: new Date() },
            });
            resolveId(row.id);
            release();
            return this.view(row.id);
          }
        }
      }

      const row = await this.prisma.vehicleHistoryRequest.create({ data: { ...base, status: 'running', attemptLog: [] } });
      const job = this.run(row.id, vin, input.type, input.onlyProvider)
        .catch((err) => this.logger.error(`Request ${row.id} crashed: ${(err as Error).stack ?? err}`))
        .finally(() => {
          this.running.delete(row.id);
          release();
        });
      this.running.set(row.id, job);
      resolveId(row.id);
      return this.waitAndView(row.id, waitMs);
    } catch (err) {
      rejectId(err);
      release();
      throw err;
    }
  }

  /** Waits up to `ms` for a request running in this process, then returns its state. */
  async waitAndView(id: string, ms: number): Promise<RequestView> {
    const job = this.running.get(id);
    if (job && ms > 0) await Promise.race([job, new Promise((r) => setTimeout(r, ms))]);
    return this.view(id);
  }

  /** Walks the providers for one request. Never throws: the outcome is written to the request row. */
  private async run(requestId: string, vin: string, type: ReportType, onlyProvider?: string): Promise<void> {
    const started = Date.now();
    const attempts: AttemptEntry[] = [];
    const settings = await this.getSettings();
    const rows = await this.prisma.vehicleHistoryProvider.findMany({ orderBy: [{ priority: 'asc' }, { key: 'asc' }] });

    // Healthy providers first, in priority order; ones behind an open circuit go last.
    const primary: { row: ProviderRow; adapter: VehicleHistoryAdapter; apiKey: string }[] = [];
    const deferred: typeof primary = [];
    for (const row of rows) {
      const adapter = ADAPTER_BY_KEY.get(row.key);
      if (!adapter) continue;
      if (onlyProvider && row.key !== onlyProvider) continue;
      const skip = (reason: string) => attempts.push({ providerKey: row.key, outcome: 'skipped', reason });
      if (!adapter.supports.includes(type)) { skip('unsupported'); continue; }
      if (!onlyProvider) {
        if (!row.enabled) { skip('disabled'); continue; }
        if ((type === 'carfax' && !row.carfaxEnabled) || (type === 'autocheck' && !row.autocheckEnabled)) { skip('type_disabled'); continue; }
      }
      const { key } = this.resolveApiKey(row, adapter);
      if (!key) { skip('unconfigured'); continue; }
      const open = !onlyProvider && row.circuitOpenUntil && row.circuitOpenUntil.getTime() > Date.now();
      (open ? deferred : primary).push({ row, adapter, apiKey: key });
    }

    let lastError: ProviderError | null = null;
    let allNotFound = true;
    for (const [i, c] of [...primary, ...deferred].entries()) {
      const isDeferred = i >= primary.length;
      const calls: CallEntry[] = [];
      const t0 = Date.now();
      const ctx = createContext({
        apiKey: c.apiKey,
        baseUrl: this.baseUrl(c.row, c.adapter),
        deadline: t0 + Math.max(10_000, c.row.timeoutMs),
        reportType: type,
        calls,
      });
      try {
        const report = await c.adapter.fetchReport(ctx, vin, type);
        await this.saveCalls(c.row.key, calls, requestId, vin);
        const stored = await this.storeReport(vin, type, c.row.key, report);
        attempts.push({ providerKey: c.row.key, outcome: 'success', durationMs: Date.now() - t0, deferred: isDeferred || undefined });
        await this.prisma.vehicleHistoryProvider.update({
          where: { key: c.row.key },
          data: { consecutiveFailures: 0, circuitOpenUntil: null, lastSuccessAt: new Date() },
        });
        await this.prisma.vehicleHistoryRequest.update({
          where: { id: requestId },
          data: { status: 'completed', reportId: stored.id, providerKey: c.row.key, attemptLog: attempts as unknown as Prisma.InputJsonValue, durationMs: Date.now() - started, completedAt: new Date() },
        });
        this.logger.log(`${type} ${vin} served by ${c.row.key} after ${attempts.filter((a) => a.outcome === 'failed').length} failed attempt(s)`);
        return;
      } catch (raw) {
        const err = raw instanceof ProviderError ? raw : new ProviderError('upstream', String((raw as Error)?.message ?? raw).slice(0, 300));
        // The call that broke carries the error, unless the adapter already marked it.
        const last = calls[calls.length - 1];
        if (last && last.ok) {
          last.ok = false;
          last.errorCode = err.code;
          last.message = err.message.slice(0, 500);
        }
        await this.saveCalls(c.row.key, calls, requestId, vin);
        attempts.push({ providerKey: c.row.key, outcome: 'failed', errorCode: err.code, message: err.message.slice(0, 300), durationMs: Date.now() - t0, deferred: isDeferred || undefined });
        lastError = err;
        if (err.code !== 'not_found') allNotFound = false;
        // An accepted (paid) job that outlived the budget is checked again in the background.
        if (err.resumeToken && c.adapter.resumeJob) {
          await this.prisma.vehicleHistoryPendingJob
            .upsert({
              where: { providerKey_token: { providerKey: c.row.key, token: err.resumeToken } },
              update: {},
              create: { providerKey: c.row.key, vin, reportType: type, token: err.resumeToken, requestId },
            })
            .catch((e) => this.logger.warn(`Could not queue ${c.row.key} job ${err.resumeToken}: ${(e as Error).message}`));
        }
        await this.recordFailure(c.row, err, settings);
        this.logger.warn(`${type} ${vin}: ${c.row.key} failed (${err.code}: ${err.message})`);
        if (err.scope === 'input') break;
      }
    }

    const tried = attempts.some((a) => a.outcome === 'failed');
    const code = !tried ? 'no_providers' : allNotFound ? 'not_found' : lastError?.scope === 'input' ? lastError.code : 'all_failed';
    await this.prisma.vehicleHistoryRequest.update({
      where: { id: requestId },
      data: {
        status: 'failed',
        errorCode: code,
        errorMessage: code === 'invalid_vin' ? lastError?.message ?? null : ERROR_TEXT[code] ?? lastError?.message ?? null,
        attemptLog: attempts as unknown as Prisma.InputJsonValue,
        durationMs: Date.now() - started,
        completedAt: new Date(),
      },
    });
  }

  /** Provider-side failures feed the circuit breaker; "no report for this VIN" proves it's up. */
  private async recordFailure(row: ProviderRow, err: ProviderError, settings: SettingsRow): Promise<void> {
    if (err.scope !== 'provider') {
      await this.prisma.vehicleHistoryProvider.update({ where: { key: row.key }, data: { consecutiveFailures: 0 } });
      return;
    }
    const updated = await this.prisma.vehicleHistoryProvider.update({
      where: { key: row.key },
      data: { consecutiveFailures: { increment: 1 }, lastFailureAt: new Date(), lastError: `${err.code}: ${err.message}`.slice(0, 500) },
    });
    if (updated.consecutiveFailures >= Math.max(1, settings.circuitFailureThreshold)) {
      const until = new Date(Date.now() + Math.max(1, settings.circuitCooldownMinutes) * 60_000);
      await this.prisma.vehicleHistoryProvider.update({ where: { key: row.key }, data: { circuitOpenUntil: until } });
      this.logger.warn(`Circuit open for ${row.key} until ${until.toISOString()} (${updated.consecutiveFailures} failures in a row)`);
    }
  }

  private async storeReport(vin: string, type: ReportType, providerKey: string, report: { body: Buffer; contentType: string; yearMakeModel?: string | null; providerReportId?: string | null }) {
    const ext = report.contentType === 'application/pdf' ? 'pdf' : 'html';
    const s3Key = `vehicle-history/${type}/${vin}/${Date.now()}-${providerKey}.${ext}`;
    const contentType = report.contentType === 'text/html' ? 'text/html; charset=utf-8' : report.contentType;
    await this.s3.uploadBufferToKey(report.body, s3Key, contentType);
    return this.prisma.vehicleHistoryReport.create({
      data: {
        vin,
        reportType: type,
        providerKey,
        providerReportId: report.providerReportId ?? null,
        s3Key,
        contentType: report.contentType,
        yearMakeModel: report.yearMakeModel ?? null,
        sizeBytes: report.body.length,
      },
    });
  }

  private async saveCalls(providerKey: string, calls: CallEntry[], requestId: string | null, vin: string | null): Promise<void> {
    if (!calls.length) return;
    try {
      await this.prisma.vehicleHistoryCall.createMany({
        data: calls.map((c) => ({
          providerKey,
          kind: c.kind,
          reportType: c.reportType,
          method: c.method,
          route: c.route,
          httpStatus: c.httpStatus,
          ok: c.ok,
          errorCode: c.errorCode,
          message: c.message,
          durationMs: c.durationMs,
          vin,
          requestId,
          createdAt: new Date(c.startedAt),
        })),
      });
    } catch (err) {
      this.logger.warn(`Could not save the ${providerKey} call log: ${(err as Error).message}`);
    }
  }

  // ── Reading requests ────────────────────────────────────────────────────

  async view(id: string): Promise<RequestView> {
    const row = await this.prisma.vehicleHistoryRequest.findUnique({ where: { id }, include: { report: true } });
    if (!row) throw new NotFoundException('Request not found');
    const report = row.report
      ? {
          id: row.report.id,
          s3Key: row.report.s3Key,
          contentType: row.report.contentType,
          yearMakeModel: row.report.yearMakeModel,
          providerKey: row.report.providerKey,
          createdAt: row.report.createdAt,
          url: await this.s3.getSignedUrl(row.report.s3Key, 3600, { contentType: row.report.contentType === 'text/html' ? 'text/html; charset=utf-8' : row.report.contentType, disposition: 'inline' }),
        }
      : null;
    return {
      id: row.id,
      vin: row.vin,
      reportType: row.reportType as ReportType,
      status: row.status as RequestView['status'],
      source: row.source,
      cacheHit: row.cacheHit,
      forced: row.forced,
      providerKey: row.providerKey,
      providerName: row.providerKey ? ADAPTER_BY_KEY.get(row.providerKey)?.name ?? row.providerKey : null,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      attempts: (row.attemptLog as unknown as AttemptEntry[]) ?? [],
      durationMs: row.durationMs,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
      report,
    };
  }

  /** Stored reports for a VIN (newest first), with view URLs. */
  async reportsForVin(rawVin: string, type?: ReportType) {
    const vin = normalizeVin(rawVin);
    if (!VIN_RE.test(vin)) throw new BadRequestException('VIN must be 17 characters (no I, O or Q)');
    const rows = await this.prisma.vehicleHistoryReport.findMany({
      where: { vin, ...(type ? { reportType: type } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return Promise.all(
      rows.map(async (r) => ({
        ...r,
        url: await this.s3.getSignedUrl(r.s3Key, 3600, { contentType: r.contentType === 'text/html' ? 'text/html; charset=utf-8' : r.contentType, disposition: 'inline' }),
      })),
    );
  }

  // ── Health ──────────────────────────────────────────────────────────────

  /** Runs the provider's free health/balance call and stores the result. */
  async checkHealth(key: string) {
    const adapter = ADAPTER_BY_KEY.get(key);
    const row = await this.prisma.vehicleHistoryProvider.findUnique({ where: { key } });
    if (!adapter || !row) throw new NotFoundException('Unknown provider');
    const { key: apiKey } = this.resolveApiKey(row, adapter);
    if (!apiKey) {
      return this.prisma.vehicleHistoryProvider.update({
        where: { key },
        data: { healthStatus: 'unconfigured', healthCheckedAt: new Date(), healthLatencyMs: null, healthMessage: `No API key (set it here or in ${adapter.envApiKey})` },
      });
    }
    const calls: CallEntry[] = [];
    const ctx = createContext({ apiKey, baseUrl: this.baseUrl(row, adapter), deadline: Date.now() + HEALTH_BUDGET_MS, reportType: null, calls });
    const t0 = Date.now();
    let data: Prisma.VehicleHistoryProviderUpdateInput;
    try {
      const h = await adapter.healthCheck(ctx);
      data = {
        healthStatus: h.status,
        healthMessage: h.message ?? null,
        balance: (h.balance ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      };
    } catch (raw) {
      const err = raw instanceof ProviderError ? raw : new ProviderError('upstream', String((raw as Error)?.message ?? raw));
      const last = calls[calls.length - 1];
      if (last && last.ok) Object.assign(last, { ok: false, errorCode: err.code, message: err.message.slice(0, 500) });
      // Out of credits or rate-limited still answers: degraded, not down.
      data = { healthStatus: err.code === 'no_credits' || err.code === 'rate_limited' ? 'degraded' : 'down', healthMessage: `${err.code}: ${err.message}`.slice(0, 500) };
    }
    await this.saveCalls(key, calls, null, null);
    return this.prisma.vehicleHistoryProvider.update({
      where: { key },
      data: { ...data, healthCheckedAt: new Date(), healthLatencyMs: Date.now() - t0 },
    });
  }

  async checkAllHealth() {
    const rows = await this.prisma.vehicleHistoryProvider.findMany({ select: { key: true } });
    for (const r of rows) {
      if (!ADAPTER_BY_KEY.has(r.key)) continue;
      await this.checkHealth(r.key).catch((err) => this.logger.warn(`Health ${r.key}: ${(err as Error).message}`));
    }
  }

  /** Background health checks, at the interval set in the settings. Only enabled providers. */
  @Cron('*/5 * * * *')
  async healthTick() {
    const settings = await this.getSettings().catch(() => null);
    if (!settings || settings.healthCheckMinutes <= 0) return;
    const due = new Date(Date.now() - settings.healthCheckMinutes * 60_000 + 30_000);
    const rows = await this.prisma.vehicleHistoryProvider.findMany({
      where: { enabled: true, OR: [{ healthCheckedAt: null }, { healthCheckedAt: { lt: due } }] },
      select: { key: true },
    });
    for (const r of rows) {
      if (!ADAPTER_BY_KEY.has(r.key)) continue;
      await this.checkHealth(r.key).catch((err) => this.logger.warn(`Health ${r.key}: ${(err as Error).message}`));
    }
  }

  /** Requests cut off by a restart never finish on their own. */
  @Cron('*/10 * * * *')
  async sweepStale() {
    const stale = await this.prisma.vehicleHistoryRequest.findMany({
      where: { status: 'running', createdAt: { lt: new Date(Date.now() - STALE_MS) } },
      select: { id: true },
    });
    const ids = stale.map((s) => s.id).filter((id) => !this.running.has(id));
    if (!ids.length) return;
    await this.prisma.vehicleHistoryRequest.updateMany({
      where: { id: { in: ids }, status: 'running' },
      data: { status: 'failed', errorCode: 'interrupted', errorMessage: ERROR_TEXT.interrupted, completedAt: new Date() },
    });
  }

  /**
   * Picks up paid jobs that outlived their time budget. A finished one is
   * stored like any report (so the VIN is served from the cache from now on)
   * and, if its order had failed, the order is completed late.
   */
  @Cron('*/2 * * * *')
  async resumePendingJobs() {
    await this.prisma.vehicleHistoryPendingJob.updateMany({
      where: { status: 'pending', createdAt: { lt: new Date(Date.now() - RESUME_WINDOW_MS) } },
      data: { status: 'expired', checkedAt: new Date() },
    });
    const jobs = await this.prisma.vehicleHistoryPendingJob.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' }, take: 20 });
    for (const job of jobs) await this.resumeJob(job.id).catch((err) => this.logger.warn(`Resume ${job.id}: ${(err as Error).message}`));
  }

  async resumeJob(pendingId: string) {
    const job = await this.prisma.vehicleHistoryPendingJob.findUnique({ where: { id: pendingId } });
    if (!job || job.status !== 'pending') return job;
    const adapter = ADAPTER_BY_KEY.get(job.providerKey);
    const row = await this.prisma.vehicleHistoryProvider.findUnique({ where: { key: job.providerKey } });
    if (!adapter?.resumeJob || !row) {
      return this.prisma.vehicleHistoryPendingJob.update({ where: { id: job.id }, data: { status: 'failed', lastError: 'Provider no longer available', checkedAt: new Date() } });
    }
    const { key } = this.resolveApiKey(row, adapter);
    const calls: CallEntry[] = [];
    const type = job.reportType as ReportType;
    const ctx = createContext({ apiKey: key, baseUrl: this.baseUrl(row, adapter), deadline: Date.now() + 60_000, reportType: type, calls });
    try {
      const result = await adapter.resumeJob(ctx, job.token, job.vin, type);
      await this.saveCalls(job.providerKey, calls, job.requestId, job.vin);
      if (result === 'pending') {
        return this.prisma.vehicleHistoryPendingJob.update({ where: { id: job.id }, data: { checks: { increment: 1 }, checkedAt: new Date() } });
      }
      const stored = await this.storeReport(job.vin, type, job.providerKey, result);
      await this.prisma.vehicleHistoryProvider.update({ where: { key: job.providerKey }, data: { consecutiveFailures: 0, circuitOpenUntil: null, lastSuccessAt: new Date() } });
      const request = job.requestId ? await this.prisma.vehicleHistoryRequest.findUnique({ where: { id: job.requestId } }) : null;
      if (request && request.status === 'failed') {
        const attempts = [...(((request.attemptLog as unknown) as AttemptEntry[]) ?? []), { providerKey: job.providerKey, outcome: 'success' as const, late: true, durationMs: Date.now() - job.createdAt.getTime() }];
        await this.prisma.vehicleHistoryRequest.update({
          where: { id: request.id },
          data: { status: 'completed', reportId: stored.id, providerKey: job.providerKey, errorCode: null, errorMessage: null, attemptLog: attempts as unknown as Prisma.InputJsonValue, completedAt: new Date() },
        });
      }
      this.logger.log(`${type} ${job.vin}: ${job.providerKey} job ${job.token} delivered late`);
      return this.prisma.vehicleHistoryPendingJob.update({
        where: { id: job.id },
        data: { status: 'completed', reportId: stored.id, checks: { increment: 1 }, checkedAt: new Date(), completedAt: new Date() },
      });
    } catch (raw) {
      const err = raw instanceof ProviderError ? raw : new ProviderError('upstream', String((raw as Error)?.message ?? raw).slice(0, 300));
      const last = calls[calls.length - 1];
      if (last && last.ok) Object.assign(last, { ok: false, errorCode: err.code, message: err.message.slice(0, 500) });
      await this.saveCalls(job.providerKey, calls, job.requestId, job.vin);
      // A network blip is retried on the next tick; a definite answer ends the job.
      const final = err.code !== 'network' && err.code !== 'timeout' && !(err.code === 'upstream' && (err.httpStatus ?? 0) >= 500);
      return this.prisma.vehicleHistoryPendingJob.update({
        where: { id: job.id },
        data: { status: final ? 'failed' : 'pending', lastError: `${err.code}: ${err.message}`.slice(0, 500), checks: { increment: 1 }, checkedAt: new Date() },
      });
    }
  }

  /** Call log retention. */
  @Cron('20 3 * * *')
  async pruneCalls() {
    const settings = await this.getSettings();
    if (settings.logRetentionDays <= 0) return;
    const { count } = await this.prisma.vehicleHistoryCall.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - settings.logRetentionDays * 86_400_000) } },
    });
    if (count) this.logger.log(`Pruned ${count} provider call log rows`);
  }
}
