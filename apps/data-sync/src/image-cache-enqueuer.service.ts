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
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async retrySkipped(): Promise<number> {
    const today = new Date();
    const todayInt =
      today.getUTCFullYear() * 10000 + (today.getUTCMonth() + 1) * 100 + today.getUTCDate();

    // `priority` holds the lot's saleDate as YYYYMMDD, so the "not auctioned
    // yet" filter runs in the query instead of pulling rows to filter in memory.
    const stale = await this.prisma.imageCacheJob.findMany({
      where: {
        status: 'skipped',
        priority: { gte: todayInt },
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
