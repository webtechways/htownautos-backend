import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import {
  BIDEXPORT_FILTER_URL,
  ProxyService,
  inIaaiWindow,
  mapBidexportItem,
  scheduleWantsRun,
} from '@htownautos/common';

type Config = Prisma.IaaiScraperConfigGetPayload<{}>;
type Run = Prisma.IaaiScrapeRunGetPayload<{}>;

/** A run whose worker stopped heartbeating this long ago is considered orphaned. */
const STALE_RUN_MS = 3 * 60_000;
/** Consecutive failed pages before the pass gives up. */
const MAX_CONSECUTIVE_FAILURES = 5;
const HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://bidexport.com',
  Referer: 'https://bidexport.com/',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const between = (min: number, max: number) => min + Math.floor(Math.random() * Math.max(0, max - min));

/**
 * Scrapes IAAI inventory from bidexport.com into `iaai_listings`.
 *
 * A pass walks `POST /filter?limit=<pageSize>&skip=<n>` from 0 to the reported
 * count, upserting by stock number. The DB is the control bus (same as the
 * image cache): Settings → IAAI Scraper writes `iaai_scraper_config` and
 * `iaai_scrape_runs`, this worker reads them between pages, so Pause/Stop take
 * effect within one page.
 *
 * A pass cut short by the end of the daily window is `interrupted` and resumes
 * from its `nextSkip` next time; one stopped by a person, the pause switch or
 * the max duration ends `stopped`, and the next one starts from 0.
 */
@Injectable()
export class IaaiScraperService implements OnModuleInit {
  private readonly logger = new Logger(IaaiScraperService.name);
  private busy = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly proxy: ProxyService,
  ) {}

  async onModuleInit() {
    await this.config();
  }

  private async config(): Promise<Config> {
    return this.prisma.iaaiScraperConfig.upsert({ where: { id: 'singleton' }, create: {}, update: {} });
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const run = await this.pickRun();
      if (run) await this.execute(run);
    } catch (err) {
      this.logger.error(`[IaaiScraper] tick failed: ${(err as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  /** The run to work on now, if any: orphaned → queued manual → schedule. */
  private async pickRun(): Promise<Run | null> {
    const cfg = await this.config();
    const now = new Date();

    // A pass whose worker died (deploy, crash) is picked up where it was.
    const orphan = await this.prisma.iaaiScrapeRun.findFirst({
      where: { status: 'running', OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: new Date(now.getTime() - STALE_RUN_MS) } }] },
      orderBy: { createdAt: 'asc' },
    });
    if (orphan) return orphan;

    const queued = await this.prisma.iaaiScrapeRun.findFirst({ where: { status: 'queued' }, orderBy: { createdAt: 'asc' } });
    if (queued) {
      if (cfg.paused) return null; // Start un-pauses; a queued run under pause waits
      return queued;
    }

    if (cfg.paused || cfg.scheduleMode === 'manual') return null;

    // Resume a pass the window cut short, while we are back inside it.
    const interrupted = await this.prisma.iaaiScrapeRun.findFirst({
      where: { status: 'interrupted', createdAt: { gt: new Date(now.getTime() - 36 * 3600_000) } },
      orderBy: { createdAt: 'desc' },
    });
    if (interrupted && (cfg.scheduleMode !== 'window' || inIaaiWindow(cfg, now))) return interrupted;

    const last = await this.prisma.iaaiScrapeRun.findFirst({
      where: { startedAt: { not: null } },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true },
    });
    if (!scheduleWantsRun(cfg, now, last?.startedAt ?? null)) return null;
    return this.prisma.iaaiScrapeRun.create({ data: { trigger: 'schedule', status: 'queued', maxRunMinutes: cfg.maxRunMinutes || null } });
  }

  private async execute(start: Run): Promise<void> {
    let run = await this.prisma.iaaiScrapeRun.update({
      where: { id: start.id },
      data: { status: 'running', startedAt: start.startedAt ?? new Date(), heartbeatAt: new Date(), message: null },
    });
    const segmentStartedAt = Date.now();
    this.logger.log(`[IaaiScraper] run ${run.id} (${run.trigger}) from skip ${run.nextSkip}`);

    let failures = 0;
    let pagesThisSegment = 0;
    for (;;) {
      const cfg = await this.config();
      const fresh = await this.prisma.iaaiScrapeRun.findUnique({ where: { id: run.id }, select: { stopRequested: true } });

      // ── Should this pass keep going? ─────────────────────────────────────
      const stop = (status: string, message: string) => this.finish(run.id, status, message);
      if (fresh?.stopRequested) return stop('stopped', 'Stopped from Settings');
      if (cfg.paused) return stop('stopped', 'Scraper paused');
      const limitMin = run.maxRunMinutes ?? cfg.maxRunMinutes;
      if (limitMin > 0 && Date.now() - segmentStartedAt >= limitMin * 60_000) {
        return stop('stopped', `Reached the ${limitMin} min limit`);
      }
      if (run.trigger === 'schedule' && cfg.scheduleMode === 'window' && !inIaaiWindow(cfg, new Date())) {
        return stop('interrupted', 'Daily window ended; resumes in the next window');
      }
      if (cfg.maxPagesPerRun > 0 && pagesThisSegment >= cfg.maxPagesPerRun) {
        return stop('stopped', `Reached the ${cfg.maxPagesPerRun} page limit`);
      }

      // ── One page ─────────────────────────────────────────────────────────
      const pageSize = Math.min(500, Math.max(10, cfg.pageSize));
      let page: { count: number; data: Record<string, any>[] };
      try {
        page = await this.fetchPage(run.nextSkip, pageSize, cfg);
        failures = 0;
      } catch (err) {
        failures += 1;
        const msg = (err as Error).message.slice(0, 500);
        run = await this.prisma.iaaiScrapeRun.update({
          where: { id: run.id },
          data: { errors: { increment: 1 }, lastError: msg, heartbeatAt: new Date() },
        });
        this.logger.warn(`[IaaiScraper] page skip=${run.nextSkip} failed (${failures}/${MAX_CONSECUTIVE_FAILURES}): ${msg}`);
        if (failures >= MAX_CONSECUTIVE_FAILURES) return stop('failed', `${failures} pages in a row failed: ${msg}`);
        await sleep(between(5_000, 15_000) * failures);
        continue;
      }

      const { created, updated } = await this.store(page.data);
      pagesThisSegment += 1;
      const nextSkip = run.nextSkip + pageSize;
      run = await this.prisma.iaaiScrapeRun.update({
        where: { id: run.id },
        data: {
          nextSkip,
          pagesFetched: { increment: 1 },
          itemsSeen: { increment: page.data.length },
          itemsCreated: { increment: created },
          itemsUpdated: { increment: updated },
          totalReported: page.count,
          heartbeatAt: new Date(),
        },
      });

      if (page.data.length < pageSize || nextSkip >= page.count) {
        const marked = await this.markInactive(cfg);
        await this.prisma.iaaiScrapeRun.update({ where: { id: run.id }, data: { markedInactive: marked } });
        return stop('completed', `Pass complete: ${run.itemsSeen} lots seen, ${marked} marked inactive`);
      }
      await sleep(between(cfg.pageDelayMinMs, Math.max(cfg.pageDelayMinMs, cfg.pageDelayMaxMs)));
    }
  }

  private async finish(id: string, status: string, message: string) {
    await this.prisma.iaaiScrapeRun.update({ where: { id }, data: { status, message, finishedAt: new Date(), heartbeatAt: new Date() } });
    this.logger.log(`[IaaiScraper] run ${id} ${status}: ${message}`);
  }

  private async fetchPage(skip: number, limit: number, cfg: Config): Promise<{ count: number; data: Record<string, any>[] }> {
    const url = `${BIDEXPORT_FILTER_URL}?limit=${limit}&skip=${skip}`;
    let lastErr: Error | null = null;
    for (let attempt = 1; attempt <= Math.max(1, cfg.maxRetries); attempt++) {
      try {
        const res = cfg.useProxy
          ? await this.proxy.fetchViaProxy(url, { method: 'POST', body: '{}', headers: HEADERS, maxAttempts: 3, timeoutMs: cfg.requestTimeoutMs })
          : await fetch(url, { method: 'POST', body: '{}', headers: HEADERS, signal: AbortSignal.timeout(cfg.requestTimeoutMs) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { count?: number; data?: unknown };
        if (!Array.isArray(json?.data)) throw new Error('Unexpected response: no data array');
        return { count: Number(json.count) || 0, data: json.data as Record<string, any>[] };
      } catch (err) {
        lastErr = err as Error;
        if (attempt < cfg.maxRetries) await sleep(2_000 * attempt);
      }
    }
    throw lastErr ?? new Error('fetch failed');
  }

  /** Upsert one page. Photos go back to `pending` only when their list changes. */
  private async store(items: Record<string, any>[]): Promise<{ created: number; updated: number }> {
    const mapped = items.map(mapBidexportItem).filter((m): m is NonNullable<typeof m> => !!m);
    if (!mapped.length) return { created: 0, updated: 0 };
    const unique = [...new Map(mapped.map((m) => [m.stockNumber, m])).values()];

    const existing = await this.prisma.iaaiListing.findMany({
      where: { stockNumber: { in: unique.map((m) => m.stockNumber) } },
      select: { stockNumber: true, imageSourceHash: true, imagesStatus: true },
    });
    const known = new Map(existing.map((e) => [e.stockNumber, e]));

    const branchCodes = [...new Set(unique.map((m) => m.data.branchCode as number | null).filter((n): n is number => !!n))];
    const yards = branchCodes.length
      ? await this.prisma.yard.findMany({ where: { source: 'IAAI', yardNumber: { in: branchCodes } }, select: { id: true, yardNumber: true } })
      : [];
    const yardBy = new Map(yards.map((y) => [y.yardNumber, y.id]));

    const now = new Date();
    const fresh = unique.filter((m) => !known.has(m.stockNumber));
    const old = unique.filter((m) => known.has(m.stockNumber));

    if (fresh.length) {
      await this.prisma.iaaiListing.createMany({
        data: fresh.map((m) => ({
          ...(m.data as object),
          stockNumber: m.stockNumber,
          yardId: yardBy.get(m.data.branchCode as number) ?? null,
          imageSourceUrls: m.imageUrls,
          imageSourceHash: m.imageHash,
          imagesStatus: m.imageUrls.length ? 'pending' : 'none',
          raw: m.data.raw as Prisma.InputJsonValue,
          isActive: true,
          firstSeenAt: now,
          lastSeenAt: now,
        })) as Prisma.IaaiListingCreateManyInput[],
        skipDuplicates: true,
      });
    }

    if (old.length) {
      await this.prisma.$transaction(
        old.map((m) => {
          const prev = known.get(m.stockNumber)!;
          const photosChanged = prev.imageSourceHash !== m.imageHash;
          return this.prisma.iaaiListing.update({
            where: { stockNumber: m.stockNumber },
            data: {
              ...(m.data as object),
              yardId: yardBy.get(m.data.branchCode as number) ?? null,
              raw: m.data.raw as Prisma.InputJsonValue,
              isActive: true,
              lastSeenAt: now,
              ...(photosChanged && {
                imageSourceUrls: m.imageUrls,
                imageSourceHash: m.imageHash,
                imagesStatus: m.imageUrls.length ? 'pending' : 'none',
                imagesAttempts: 0,
                imagesError: null,
              }),
            } as Prisma.IaaiListingUpdateInput,
          });
        }),
      );
    }
    return { created: fresh.length, updated: old.length };
  }

  /**
   * Lots not seen for `inactiveAfterHours`. Not "not seen in this pass": the
   * listing shifts while a pass pages through it (lots sell and drop out), so
   * one pass can miss a lot that is still for sale.
   */
  private async markInactive(cfg: Config): Promise<number> {
    if (cfg.inactiveAfterHours <= 0) return 0;
    const res = await this.prisma.iaaiListing.updateMany({
      where: { isActive: true, lastSeenAt: { lt: new Date(Date.now() - cfg.inactiveAfterHours * 3600_000) } },
      data: { isActive: false },
    });
    return res.count;
  }
}
