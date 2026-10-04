import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { RabbitMQService } from '@htownautos/rabbitmq';
import {
  CopartImagesService,
  ImageFetchBlockedError,
  GALLERY_CACHE_QUEUE,
  iaaiGalleryImages,
} from '@htownautos/common';
import type { GalleryCacheMessage } from '@htownautos/common';

type Auction = 'COPART' | 'IAAI';
import { futureSaleWhere } from '@htownautos/auction-matching';

// Fallbacks if the singleton control row is missing.
const DEFAULT_LOTS_PER_TICK = 6;
const DEFAULT_MAX_ATTEMPTS = 5;

// Keep a buffer of pending jobs ready so the crawler never idles waiting on the
// seeder. When pending drops below the low-water mark, top up from un-cached lots.
const SEED_LOW_WATER = 200;
const SEED_BATCH = 500;

// Processing jobs older than this were orphaned (consumer/worker died) — requeue.
const STALE_PROCESSING_MIN = 15;

/**
 * Never let more than this many minutes of work sit in RabbitMQ. Without this
 * cap, dispatching faster than the consumer drains built a queue deeper than
 * STALE_PROCESSING_MIN of work; the orphan reaper then flipped still-queued jobs
 * back to `pending`, the crawler republished them, and each pass multiplied the
 * duplicates (observed: 73k messages for 1.6k lots, one lot dispatched 113 times).
 */
const MAX_QUEUE_MINUTES = 3;

/**
 * Drains the ImageCacheJob queue at a controlled, pausable rate so Copart is hit
 * gently. Also seeds the queue from the backlog of un-cached lots, prioritized by
 * soonest auction date. Runs in data-sync (has Schedule + RabbitMQ + Prisma).
 *
 * Per tick (when not paused):
 *   1. Requeue orphaned `processing` jobs.
 *   2. Top up `pending` jobs from the un-cached backlog (soonest saleDate first).
 *   3. Claim up to `lotsPerTick` pending jobs; for each, fetch the Copart image
 *      list via the proxy and publish to `gallery.cache` (image-service uploads to
 *      S3 and finalizes the job). Already-cached lots are closed as `done`.
 */
@Injectable()
export class ImageCacheCrawlerService {
  private readonly logger = new Logger(ImageCacheCrawlerService.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitMQ: RabbitMQService,
    private readonly copartImages: CopartImagesService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (this.isRunning) return; // never overlap
    this.isRunning = true;
    try {
      const config = await this.prisma.imageScrapeConfig.findUnique({
        where: { id: 'singleton' },
      });
      if (config?.paused) return;

      const lotsPerTick = config?.lotsPerTick ?? DEFAULT_LOTS_PER_TICK;
      const maxAttempts = config?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

      // Flow control first: how much room is there in the broker right now?
      const budget = await this.dispatchBudget(lotsPerTick);

      await this.requeueOrphans(budget.depth);
      await this.topUpQueue();
      if (budget.slots > 0) {
        await this.dispatch(budget.slots, maxAttempts);
      } else {
        this.logger.log(
          `[ImageCacheCrawler] Queue is ${budget.depth} deep (cap ${budget.cap}) — skipping dispatch`,
        );
      }
    } catch (err) {
      this.logger.error(`[ImageCacheCrawler] Tick failed: ${(err as Error).message}`);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * How many lots may be published this tick. Keeps the broker holding at most
   * MAX_QUEUE_MINUTES of work so a queued job is never mistaken for an orphan.
   */
  private async dispatchBudget(lotsPerTick: number): Promise<{
    slots: number;
    depth: number;
    cap: number;
  }> {
    const cap = Math.max(lotsPerTick, lotsPerTick * MAX_QUEUE_MINUTES);
    const depth = await this.rabbitMQ.queueDepth(GALLERY_CACHE_QUEUE);
    // Unknown depth (broker down) → fall back to the configured rate; publish
    // will fail and re-mark the jobs pending anyway.
    if (depth === null) return { slots: lotsPerTick, depth: -1, cap };
    return { slots: Math.max(0, Math.min(lotsPerTick, cap - depth)), depth, cap };
  }

  /**
   * Requeue `processing` jobs abandoned by a dead consumer/worker.
   *
   * Skipped while the broker still holds a real backlog: those jobs are queued,
   * not orphaned, and requeueing them is what created the duplicate storm.
   */
  private async requeueOrphans(queueDepth: number): Promise<void> {
    if (queueDepth > 0) return;
    const cutoff = new Date(Date.now() - STALE_PROCESSING_MIN * 60_000);
    const res = await this.prisma.imageCacheJob.updateMany({
      where: { status: 'processing', lastAttemptAt: { lt: cutoff } },
      data: { status: 'pending' },
    });
    if (res.count > 0) {
      this.logger.warn(`[ImageCacheCrawler] Requeued ${res.count} orphaned processing job(s)`);
    }
  }

  /**
   * Seed the queue from the backlog of un-cached, future-sale Copart lots when
   * pending work runs low. Uses a raw INSERT ... SELECT so the whole backlog is
   * never loaded into memory; skips lots that already have a job row.
   */
  private async topUpQueue(): Promise<void> {
    const pending = await this.prisma.imageCacheJob.count({ where: { status: 'pending' } });
    if (pending >= SEED_LOW_WATER) return;

    // futureSaleWhere() → { OR: [{ saleDate: null }, { saleDate: { gte: todayInt - 1 } }] }
    const future = futureSaleWhere() as { OR?: Array<{ saleDate?: { gte?: number } }> };
    const saleFloor =
      future.OR?.find((c) => typeof c.saleDate?.gte === 'number')?.saleDate?.gte ?? 0;

    // Only backfill RECENTLY-ARRIVED lots (last 48h) — the old backlog is
    // intentionally ignored; new arrivals come through the enqueuer, this is a
    // safety net for any the enqueuer missed. Soonest auction first.
    const inserted = await this.prisma.$executeRaw`
      INSERT INTO "image_cache_jobs" ("auction", "lotNumber", "status", "priority", "source", "updatedAt")
      SELECT 'COPART', al."lotNumber", 'pending', al."saleDate", 'backfill', NOW()
      FROM "auction_listings" al
      WHERE al."auctionName" = 'Copart'
        AND al."galleryCache" IS NULL
        AND al."isStale" = false
        AND al."discarded" = false
        AND al."createdAt" >= NOW() - INTERVAL '48 hours'
        AND (al."saleDate" IS NULL OR al."saleDate" >= ${saleFloor})
        AND NOT EXISTS (SELECT 1 FROM "image_cache_jobs" j WHERE j."auction" = 'COPART' AND j."lotNumber" = al."lotNumber")
      ORDER BY al."saleDate" ASC NULLS LAST
      LIMIT ${SEED_BATCH}
      ON CONFLICT ("auction", "lotNumber") DO NOTHING
    `;
    if (inserted > 0) {
      this.logger.log(`[ImageCacheCrawler] Seeded ${inserted} lot(s) into the queue from backlog`);
    }
    await this.topUpIaai();
  }

  /**
   * IAAI lots still without photos, from the scraper's table. Unlike Copart
   * there is no 48h window: the whole IAAI backlog is wanted, soonest auction
   * first, and a lot that already has photos is never queued again.
   * Off when Settings → IAAI Scraper has photo download disabled.
   */
  private async topUpIaai(): Promise<void> {
    const cfg = await this.prisma.iaaiScraperConfig.findUnique({ where: { id: 'singleton' }, select: { downloadImages: true, imagesOnlyUpcoming: true } });
    if (!cfg?.downloadImages) return;
    const upcomingOnly = cfg.imagesOnlyUpcoming;
    const inserted = await this.prisma.$executeRaw`
      INSERT INTO "image_cache_jobs" ("auction", "lotNumber", "status", "priority", "source", "updatedAt")
      SELECT 'IAAI', l."stockNumber"::bigint, 'pending',
             to_char((l."auctionAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago', 'YYYYMMDD')::int,
             'backfill', NOW()
      FROM "iaai_listings" l
      WHERE l."images" IS NULL
        AND l."imageCount" > 0
        AND l."isActive" = true
        AND l."stockNumber" ~ '^[0-9]{1,18}$'
        AND (${!upcomingOnly} OR l."auctionAt" IS NULL OR l."auctionAt" > NOW())
        AND NOT EXISTS (SELECT 1 FROM "image_cache_jobs" j WHERE j."auction" = 'IAAI' AND j."lotNumber" = l."stockNumber"::bigint)
      ORDER BY l."auctionAt" ASC NULLS LAST
      LIMIT ${SEED_BATCH}
      ON CONFLICT ("auction", "lotNumber") DO NOTHING
    `;
    if (inserted > 0) {
      this.logger.log(`[ImageCacheCrawler] Seeded ${inserted} IAAI lot(s) into the queue`);
    }
  }

  /** Claim and dispatch up to `lotsPerTick` pending jobs. */
  private async dispatch(lotsPerTick: number, maxAttempts: number): Promise<void> {
    const jobs = await this.prisma.imageCacheJob.findMany({
      where: { status: 'pending' },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      take: lotsPerTick,
      select: { auction: true, lotNumber: true, attempts: true },
    });
    if (jobs.length === 0) return;

    for (const job of jobs) {
      const lotNumber = job.lotNumber.toString();
      const auction = job.auction as Auction;

      // Mark processing + bump attempts (job-level dispatch count, not proxy retries).
      await this.prisma.imageCacheJob.update({
        where: { auction_lotNumber: { auction, lotNumber: job.lotNumber } },
        data: { status: 'processing', attempts: { increment: 1 }, lastAttemptAt: new Date() },
      });

      if (auction === 'IAAI') {
        await this.dispatchIaai(job.lotNumber);
        continue;
      }

      // Skip if it was cached on-demand meanwhile.
      const listing = await this.prisma.auctionListing.findUnique({
        where: { lotNumber: job.lotNumber },
        select: { galleryCache: true },
      });
      if (listing?.galleryCache) {
        await this.markDone('COPART', job.lotNumber);
        continue;
      }

      try {
        const images = await this.copartImages.fetchImages(lotNumber, { maxAttempts });
        if (images.length === 0) {
          // 404 / no images published yet → not an error, just unavailable. Mark
          // skipped so it leaves the queue and never lands in the errors table.
          await this.markSkipped('COPART', job.lotNumber);
          continue;
        }
        const msg: GalleryCacheMessage = { lotNumber, images, jobId: lotNumber, auction: 'COPART' };
        const ok = await this.rabbitMQ.publish(GALLERY_CACHE_QUEUE, msg);
        if (!ok) {
          // Queue unavailable — leave it for the next tick.
          await this.prisma.imageCacheJob.update({
            where: { auction_lotNumber: { auction: 'COPART', lotNumber: job.lotNumber } },
            data: { status: 'pending', lastError: 'RabbitMQ unavailable' },
          });
        }
        // On success the image-service consumer finalizes the job (done/failed).
      } catch (err) {
        if (err instanceof ImageFetchBlockedError) {
          await this.markFailed('COPART', job.lotNumber, `Blocked after ${err.attempts} attempts (status ${err.lastStatus ?? 'n/a'})`);
        } else {
          await this.markFailed('COPART', job.lotNumber, (err as Error).message);
        }
      }
    }
  }

  /**
   * IAAI: the photo list is already in the scraped lot, so nothing is fetched
   * here. A lot that has photos is closed without downloading anything.
   */
  private async dispatchIaai(lot: bigint): Promise<void> {
    const stock = lot.toString();
    const listing = await this.prisma.iaaiListing.findUnique({
      where: { stockNumber: stock },
      select: { images: true, imageSourceUrls: true },
    });
    if (listing?.images) {
      await this.markDone('IAAI', lot);
      return;
    }
    const images = iaaiGalleryImages(listing?.imageSourceUrls);
    if (!images.length) {
      await this.markSkipped('IAAI', lot);
      await this.prisma.iaaiListing.updateMany({ where: { stockNumber: stock, images: { equals: Prisma.DbNull } }, data: { imagesStatus: 'none' } });
      return;
    }
    await this.prisma.iaaiListing.updateMany({ where: { stockNumber: stock }, data: { imagesStatus: 'processing', imagesClaimedAt: new Date() } });
    const msg: GalleryCacheMessage = { lotNumber: stock, images, jobId: stock, auction: 'IAAI' };
    const ok = await this.rabbitMQ.publish(GALLERY_CACHE_QUEUE, msg);
    if (!ok) {
      await this.prisma.imageCacheJob.update({
        where: { auction_lotNumber: { auction: 'IAAI', lotNumber: lot } },
        data: { status: 'pending', lastError: 'RabbitMQ unavailable' },
      });
    }
  }

  private async markDone(auction: Auction, lotNumber: bigint): Promise<void> {
    await this.prisma.imageCacheJob.update({
      where: { auction_lotNumber: { auction, lotNumber } },
      data: { status: 'done', lastError: null, failedSequences: Prisma.DbNull },
    });
  }

  private async markFailed(auction: Auction, lotNumber: bigint, error: string): Promise<void> {
    await this.prisma.imageCacheJob.update({
      where: { auction_lotNumber: { auction, lotNumber } },
      data: { status: 'failed', lastError: error, lastAttemptAt: new Date() },
    });
  }

  /** Terminal, non-error state for lots with no images available (404/empty). */
  private async markSkipped(auction: Auction, lotNumber: bigint): Promise<void> {
    await this.prisma.imageCacheJob.update({
      where: { auction_lotNumber: { auction, lotNumber } },
      data: { status: 'skipped', lastError: null, lastAttemptAt: new Date() },
    });
  }
}
