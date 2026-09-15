import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { PublicS3Service } from '@htownautos/common';

const CONFIG_ID = 'singleton';
/** Lots examined per run — bounds the S3 calls a single tick can make. */
const BATCH_LOTS = 500;
/** Don't re-run more often than this, however often the cron fires. */
const MIN_HOURS_BETWEEN_RUNS = 12;

/**
 * Deletes cached galleries once their auction is far enough in the past.
 *
 * This is what keeps storage flat: without it the cache grows by roughly a
 * terabyte a month (measured ~13.6k new Copart lots/day). Off by default —
 * `retentionDays = 0` keeps everything, which was the historical behaviour.
 *
 * A lot is NEVER deleted while anyone has shown interest in it: staff or buyer
 * favourite, a placed bid, membership in a listing group, a review, an AI
 * analysis, or a recorded sale result. Those are the galleries someone may still
 * need to look at — or, for sale results, train on.
 */
@Injectable()
export class ImageRetentionService {
  private readonly logger = new Logger(ImageRetentionService.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: PublicS3Service,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<void> {
    if (this.isRunning) return;

    const config = await this.prisma.imageScrapeConfig.findUnique({
      where: { id: CONFIG_ID },
    });
    const days = config?.retentionDays ?? 0;
    if (days <= 0) return; // disabled

    const last = config?.retentionLastRunAt;
    if (last && Date.now() - last.getTime() < MIN_HOURS_BETWEEN_RUNS * 3_600_000) return;

    this.isRunning = true;
    try {
      const { lots, objects } = await this.purge(days, BATCH_LOTS);
      await this.prisma.imageScrapeConfig.update({
        where: { id: CONFIG_ID },
        data: {
          retentionLastRunAt: new Date(),
          retentionDeletedLots: { increment: lots },
          retentionLastError: null,
        },
      });
      if (lots > 0) {
        this.logger.log(
          `[ImageRetention] Deleted ${objects} object(s) from ${lots} lot(s) older than ${days}d`,
        );
      }
    } catch (err: any) {
      this.logger.error(`[ImageRetention] Run failed: ${err.message}`);
      await this.prisma.imageScrapeConfig
        .update({
          where: { id: CONFIG_ID },
          data: { retentionLastRunAt: new Date(), retentionLastError: err.message },
        })
        .catch(() => undefined);
    } finally {
      this.isRunning = false;
    }
  }

  /** YYYYMMDD of `days` ago, matching AuctionListing.saleDate's format. */
  static cutoffSaleDate(days: number): number {
    const d = new Date(Date.now() - days * 86_400_000);
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  }

  /**
   * A gallery is droppable when the sale is far enough in the past, OR when the
   * lot left the Copart feed that long ago. The second arm matters: a few hundred
   * lots go stale carrying a future or missing saleDate, and a date-only rule
   * would keep their images forever.
   */
  static eligibleWhere(days: number): Prisma.AuctionListingWhereInput {
    const cutoffDate = ImageRetentionService.cutoffSaleDate(days);
    const cutoffTs = new Date(Date.now() - days * 86_400_000);
    return {
      galleryCache: { not: null },
      OR: [
        { saleDate: { not: null, lt: cutoffDate } },
        { isStale: true, updatedAt: { lt: cutoffTs } },
      ],
    };
  }

  /**
   * Lots whose gallery may be dropped: cached, auction already past the cutoff,
   * and nobody has flagged them. Exposed so the UI can preview the count before
   * anyone turns retention on.
   */
  async eligibleLots(days: number, take: number): Promise<bigint[]> {
    const candidates = await this.prisma.auctionListing.findMany({
      where: ImageRetentionService.eligibleWhere(days),
      orderBy: { saleDate: 'asc' },
      take,
      select: { lotNumber: true },
    });
    if (!candidates.length) return [];

    const lots = candidates.map((c) => c.lotNumber);
    const protectedLots = await this.protectedLots(lots);
    return lots.filter((l) => !protectedLots.has(l));
  }

  /** Lot numbers someone cared about — never delete these. */
  private async protectedLots(lots: bigint[]): Promise<Set<bigint>> {
    const where = { lotNumber: { in: lots } };
    const [favourites, buyerFavourites, bids, groupItems, reviews, analyses, sold] =
      await Promise.all([
        this.prisma.auctionFavorite.findMany({ where, select: { lotNumber: true } }),
        this.prisma.buyerFavorite.findMany({ where, select: { lotNumber: true } }),
        this.prisma.buyerAuctionBid.findMany({ where, select: { lotNumber: true } }),
        this.prisma.auctionListingGroupItem.findMany({ where, select: { lotNumber: true } }),
        this.prisma.auctionListingReview.findMany({ where, select: { lotNumber: true } }),
        this.prisma.auctionVehicleAnalysis.findMany({
          where: { auctionListingId: { in: lots } },
          select: { auctionListingId: true },
        }),
        // A lot with a sale result is a labelled training example: its photos plus a
        // real hammer price. Retention's cutoff is "auction already past", which is
        // exactly what every sold lot is, so without this arm turning retention on
        // would delete precisely the corpus the price model learns from.
        this.prisma.auctionSaleResult.findMany({
          where: { lot: { in: lots } },
          select: { lot: true },
        }),
      ]);

    const set = new Set<bigint>();
    for (const rows of [favourites, buyerFavourites, bids, groupItems, reviews]) {
      for (const r of rows as { lotNumber: bigint }[]) set.add(r.lotNumber);
    }
    for (const a of analyses) set.add(a.auctionListingId);
    for (const s of sold) set.add(s.lot);
    return set;
  }

  /** How many lots would be deleted right now (for the UI preview). */
  async eligibleCount(days: number): Promise<number> {
    if (days <= 0) return 0;
    // Ceiling: ignores the protection filter, so the job deletes this many or fewer.
    return this.prisma.auctionListing.count({
      where: ImageRetentionService.eligibleWhere(days),
    });
  }

  /** Delete the S3 objects and clear the cache pointers, one lot at a time. */
  private async purge(days: number, take: number): Promise<{ lots: number; objects: number }> {
    const lots = await this.eligibleLots(days, take);
    let deletedLots = 0;
    let deletedObjects = 0;

    for (const lot of lots) {
      try {
        deletedObjects += await this.s3.deletePrefix(`gallery/${lot.toString()}/`);
        await this.prisma.auctionListing.update({
          where: { lotNumber: lot },
          data: { galleryCache: null, galleryCachedAt: null },
        });
        // Drop the job row too, so the crawler's bookkeeping matches reality.
        // The backfill seeder only looks at lots created in the last 48h, so an
        // old lot will not be re-queued by this.
        await this.prisma.imageCacheJob
          .delete({ where: { lotNumber: lot } })
          .catch(() => undefined);
        deletedLots++;
      } catch (err: any) {
        this.logger.warn(`[ImageRetention] Lot ${lot} failed: ${err.message}`);
      }
    }

    return { lots: deletedLots, objects: deletedObjects };
  }
}
