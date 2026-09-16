import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@htownautos/prisma';

/** How many lotNumbers to pack into a single `lotNumber IN (...)` clause. */
const LOT_IN_CHUNK = 1_000;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Enqueues brand-new Copart lots for proactive image caching. Called from the
 * sync pipeline right after `newLotNumbers` are known. It only creates work
 * items (ImageCacheJob rows) — the pausable crawler drains them at a controlled
 * rate. This step is uncontrolled by design (logs only): flooding the *queue* is
 * harmless; the crawler governs how fast Copart is actually hit.
 *
 * Skips lots that already have a cached gallery (`galleryCache` set) and lots
 * that already have a job row (PK conflict → skipDuplicates).
 */
@Injectable()
export class ImageCacheEnqueuerService {
  private readonly logger = new Logger(ImageCacheEnqueuerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Put `skipped` lots back in the queue once a day.
   *
   * `skipped` is set when Copart answers with zero images, and the crawler
   * treats it as terminal. But that condition is temporary: Copart routinely
   * lists a lot days before its photos are taken, so "no images" today usually
   * means "no images yet".
   *
   * Measured on 2026-09-16: 43.307 lots sat in `skipped`, 8.594 of them not even
   * auctioned yet, and five sampled at random already had 8 to 14 photos live on
   * Copart. Those galleries were never going to be picked up, which also meant
   * those lots could never get an image vector or a price prediction.
   *
   * Only lots whose auction has not happened yet are retried: once the sale is
   * past, new photos are of no use and re-queueing them would burn proxy budget
   * on lots nobody can bid on.
   *
   * ── "Future Sale": a lot with no sale date is PENDING, not finished ──
   * Copart lists a lot before scheduling it and assigns the sale date days
   * later. Until then the lot has no `saleDate`, so `priority` — a snapshot
   * taken at enqueue time and never refreshed — stays NULL, and `priority >=
   * today` silently drops it, because NULL fails every comparison in SQL.
   *
   * That is the opposite of the intended behaviour: an undated lot cannot have
   * been auctioned yet, so it is the MOST retryable kind there is. Measured on
   * 2026-09-16: the filter matched 642 jobs while 27.569 sat trapped on a NULL
   * priority. Of those, 3.044 had since been given a future sale date, and
   * 16.557 had been dated, gone to auction and passed — their photo window was
   * missed entirely, so they carry no image vector and got no price prediction.
   * The segment is growing fast: undated lots went from 1,1% of July's intake
   * to 63,4% of the lots ingested on 2026-09-16.
   *
   * Two changes follow. `priority` is refreshed from the listing before
   * filtering, so a lot that has since been scheduled is judged on its real
   * date; and a still-undated lot is retried on the strength of being undated.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async retrySkipped(): Promise<number> {
    const today = new Date();
    const todayInt =
      today.getUTCFullYear() * 10000 + (today.getUTCMonth() + 1) * 100 + today.getUTCDate();

    await this.refreshPriorities();

    // `priority` holds the lot's saleDate as YYYYMMDD, so the "not auctioned
    // yet" filter runs in the query instead of pulling rows to filter in memory.
    const stale = await this.prisma.imageCacheJob.findMany({
      where: {
        status: 'skipped',
        OR: [
          { priority: { gte: todayInt } },
          // Still unscheduled: retry it, but not forever. Of the lots Copart
          // has not dated yet, 51% are under 5 days old, 15% under 20 and 3,4%
          // under 40; past ~45 days the curve flattens at ~1,3% and stops
          // moving, so anything older is the permanent tail, not a late
          // assignment.
          { priority: null, createdAt: { gt: new Date(Date.now() - 45 * 24 * 3_600_000) } },
        ],
        // Leave a day between attempts: photos do not appear within minutes, and
        // hammering Copart for them wastes the proxy pool.
        updatedAt: { lt: new Date(Date.now() - 24 * 3_600_000) },
      },
      select: { lotNumber: true },
      orderBy: { priority: 'asc' },
      take: 5000,
    });
    if (!stale.length) return 0;

    const { count } = await this.prisma.imageCacheJob.updateMany({
      where: { lotNumber: { in: stale.map((j) => j.lotNumber) }, status: 'skipped' },
      data: { status: 'pending', attempts: 0 },
    });
    this.logger.log(
      `[ImageCache] ${count} lot(s) back from "skipped" to "pending" ` +
      `(Copart publishes photos days after listing)`,
    );
    return count;
  }

  /**
   * Copy each job's sale date from its listing, for jobs that never got one.
   *
   * `priority` is written once, when the lot is enqueued. Copart schedules most
   * lots after that (see {@link retrySkipped}), so for the undated ones the
   * column keeps saying NULL long after the real date exists — and every rule
   * keyed on it, here and in the re-queue button, skips the lot in silence.
   *
   * Only NULL rows are touched, so this cannot move a lot that already carries
   * a date, and it costs one indexed UPDATE a night.
   */
  private async refreshPriorities(): Promise<number> {
    const updated = await this.prisma.$executeRaw`
      UPDATE image_cache_jobs j
         SET priority = l."saleDate"
        FROM auction_listings l
       WHERE l."lotNumber" = j."lotNumber"
         AND j.priority IS NULL
         AND l."saleDate" IS NOT NULL
    `;
    if (updated > 0) {
      this.logger.log(
        `[ImageCache] ${updated} job(s) picked up the sale date Copart assigned after listing`,
      );
    }
    return updated;
  }

  async enqueueNewLots(lotNumberStrings: string[]): Promise<number> {
    if (!lotNumberStrings.length) return 0;

    const lots = lotNumberStrings.map((s) => BigInt(s));
    let enqueued = 0;

    for (const batch of chunk(lots, LOT_IN_CHUNK)) {
      // Only enqueue lots that still lack a cached gallery; carry saleDate as the
      // crawler priority (soonest auction first).
      const listings = await this.prisma.auctionListing.findMany({
        where: { lotNumber: { in: batch }, galleryCache: null },
        select: { lotNumber: true, saleDate: true },
      });
      if (!listings.length) continue;

      const res = await this.prisma.imageCacheJob.createMany({
        data: listings.map((l) => ({
          lotNumber: l.lotNumber,
          priority: l.saleDate ?? null,
          status: 'pending',
          source: 'new_lot',
        })),
        skipDuplicates: true,
      });
      enqueued += res.count;
    }

    this.logger.log(
      `[ImageCacheEnqueuer] Enqueued ${enqueued}/${lotNumberStrings.length} new lot(s) for image caching`,
    );
    return enqueued;
  }
}
