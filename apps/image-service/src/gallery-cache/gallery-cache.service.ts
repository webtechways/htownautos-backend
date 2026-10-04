import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RabbitMQService } from '@htownautos/rabbitmq';
import { PrismaService } from '@htownautos/prisma';
import { Prisma } from '@prisma/client';
import {
  PublicS3Service,
  ProxyService,
  mapWithConcurrency,
  GALLERY_CACHE_QUEUE,
} from '@htownautos/common';
import type { GalleryCacheMessage } from '@htownautos/common';

// Fallback config if the singleton control row is missing.
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_CONCURRENT_LOTS = 1;
/** How often the live prefetch is re-read from the control row. */
const PREFETCH_POLL_MS = 60_000;

@Injectable()
export class GalleryCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GalleryCacheService.name);
  private prefetchTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly rabbitMQ: RabbitMQService,
    private readonly prisma: PrismaService,
    private readonly s3: PublicS3Service,
    private readonly proxyService: ProxyService,
  ) {}

  async onModuleInit() {
    const { concurrentLots } = await this.getConfig();
    await this.rabbitMQ.consume(
      GALLERY_CACHE_QUEUE,
      (msg) => this.handleMessage(msg as unknown as GalleryCacheMessage),
      { prefetch: concurrentLots },
    );
    this.logger.log(`Subscribed to ${GALLERY_CACHE_QUEUE} queue (${concurrentLots} lot(s) at once)`);

    // Let staff retune throughput from the UI without a redeploy.
    this.prefetchTimer = setInterval(() => {
      void this.getConfig()
        .then((cfg) => this.rabbitMQ.setPrefetch(GALLERY_CACHE_QUEUE, cfg.concurrentLots))
        .catch(() => undefined);
    }, PREFETCH_POLL_MS);
    this.prefetchTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.prefetchTimer) clearInterval(this.prefetchTimer);
  }

  private async handleMessage(msg: GalleryCacheMessage): Promise<void> {
    const { lotNumber, images } = msg;
    const auction = msg.auction ?? 'COPART';

    if (!lotNumber || !images?.length) {
      this.logger.warn(`[GalleryCache] Invalid message: missing lotNumber or images`);
      if (lotNumber) {
        await this.finalizeJob(auction, lotNumber, 'failed', [], 'No images to cache');
      }
      return;
    }

    // Idempotency guard. Duplicate messages for the same lot are normal (a
    // requeued job republishes), and re-downloading a gallery we already have
    // costs a full round of proxy traffic and S3 writes for nothing.
    if (await this.alreadyCached(auction, lotNumber)) {
      await this.finalizeJob(auction, lotNumber, 'done', [], null);
      this.logger.log(`[GalleryCache] ${auction} lot ${lotNumber} already cached — skipping`);
      return;
    }

    const { maxAttempts, concurrency, perSequenceDelayMs } = await this.getConfig();
    this.logger.log(
      `[GalleryCache] Processing ${auction} lot ${lotNumber} (${images.length} images, ` +
        `concurrency=${concurrency}, maxAttempts=${maxAttempts})`,
    );

    // Download + upload each sequence (thumbnail + full) with bounded concurrency.
    // Each proxied request rotates the Webshare exit IP; blocks retry up to maxAttempts.
    const perSequence = await mapWithConcurrency(images, concurrency, async (img) => {
      const [thumbnail, fullSize] = await Promise.all([
        this.uploadImage(auction, lotNumber, img.sequence, 'thb', img.thumbnail, maxAttempts),
        this.uploadImage(auction, lotNumber, img.sequence, 'hrs', img.fullSize, maxAttempts),
      ]);
      if (perSequenceDelayMs > 0) await this.sleep(perSequenceDelayMs);
      return { sequence: img.sequence, thumbnail, fullSize };
    });

    // A sequence is "cached" if at least one of thumb/full uploaded; "failed" only
    // if BOTH stayed blocked after every retry (those go to the errors table).
    const cachedImages: { sequence: number; thumbnail: string; fullSize: string }[] = [];
    const failedSequences: number[] = [];

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const r = perSequence[i];
      const uploaded = r.status === 'fulfilled' ? r.value : null;
      const s3Thumb = uploaded?.thumbnail ?? null;
      const s3Full = uploaded?.fullSize ?? null;

      if (s3Thumb || s3Full) {
        cachedImages.push({
          sequence: img.sequence,
          thumbnail: s3Thumb || img.thumbnail,
          fullSize: s3Full || img.fullSize,
        });
      } else {
        failedSequences.push(img.sequence);
      }
    }

    if (cachedImages.length === 0) {
      this.logger.error(`[GalleryCache] All uploads failed for ${auction} lot ${lotNumber}`);
      if (auction === 'IAAI') {
        await this.prisma.iaaiListing
          .updateMany({ where: { stockNumber: lotNumber }, data: { imagesStatus: 'failed', imagesError: `All ${images.length} images failed` } })
          .catch(() => undefined);
      }
      await this.finalizeJob(
        auction,
        lotNumber,
        'failed',
        failedSequences,
        `All ${images.length} images blocked after ${maxAttempts} attempts`,
      );
      return;
    }

    const cacheData = {
      lotNumber,
      imageCount: cachedImages.length,
      images: cachedImages,
    };

    if (auction === 'IAAI') {
      await this.prisma.iaaiListing.update({
        where: { stockNumber: lotNumber },
        data: {
          images: cacheData,
          imagesStatus: 'done',
          imagesError: failedSequences.length ? `${failedSequences.length} of ${images.length} failed` : null,
          imagesUpdatedAt: new Date(),
        },
      });
    } else {
      await this.prisma.auctionListing.update({
        where: { lotNumber: BigInt(lotNumber) },
        data: {
          galleryCache: JSON.stringify(cacheData),
          galleryCachedAt: new Date(),
        },
      });
    }

    const failed = failedSequences.length;
    if (failed > 0) {
      this.logger.warn(
        `[GalleryCache] Lot ${lotNumber}: ${cachedImages.length}/${images.length} cached ` +
          `(${failed} sequences failed after ${maxAttempts} attempts: ${failedSequences.join(', ')})`,
      );
    } else {
      this.logger.log(
        `[GalleryCache] Lot ${lotNumber}: ${cachedImages.length}/${images.length} images cached`,
      );
    }

    await this.finalizeJob(
      auction,
      lotNumber,
      'done',
      failedSequences,
      failed > 0 ? `${failed} image(s) failed after ${maxAttempts} attempts` : null,
    );
  }

  private async uploadImage(
    auction: 'COPART' | 'IAAI',
    lotNumber: string,
    sequence: number,
    suffix: string,
    sourceUrl: string,
    maxAttempts: number,
  ): Promise<string | null> {
    if (!sourceUrl) return null;

    // IAAI stock numbers and Copart lot numbers can collide: separate prefixes.
    const key = auction === 'IAAI' ? `iaai/${lotNumber}/${sequence}_${suffix}.jpg` : `gallery/${lotNumber}/${sequence}_${suffix}.jpg`;

    try {
      // Download from Copart via the Webshare backbone proxy (retries on block).
      const response = await this.proxyService.fetchViaProxy(sourceUrl, { maxAttempts });
      if (!response.ok) {
        throw new Error(`Failed to fetch ${sourceUrl}: ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      await this.s3.uploadBufferToKey(buffer, key, 'image/jpeg', 'public-read');
      return this.s3.buildPublicUrl(key);
    } catch (error: any) {
      this.logger.warn(`[GalleryCache] Failed to upload ${key}: ${error.message}`);
      return null;
    }
  }

  /**
   * Finalize the ImageCacheJob for this lot (if one exists). No-op for the
   * on-demand path, which has no job row. A successful on-demand cache also
   * closes any pending backfill job for the same lot (dedup).
   */
  private async alreadyCached(auction: 'COPART' | 'IAAI', lotNumber: string): Promise<boolean> {
    if (auction === 'IAAI') {
      const row = await this.prisma.iaaiListing.findUnique({ where: { stockNumber: lotNumber }, select: { images: true } });
      return !!row?.images;
    }
    const row = await this.prisma.auctionListing.findUnique({
      where: { lotNumber: BigInt(lotNumber) },
      select: { galleryCache: true },
    });
    return !!row?.galleryCache;
  }

  private async finalizeJob(
    auction: 'COPART' | 'IAAI',
    lotNumber: string,
    status: 'done' | 'failed',
    failedSequences: number[],
    lastError: string | null,
  ): Promise<void> {
    try {
      await this.prisma.imageCacheJob.updateMany({
        where: { auction, lotNumber: BigInt(lotNumber) },
        data: {
          status,
          failedSequences: failedSequences.length ? failedSequences : Prisma.DbNull,
          lastError,
          lastAttemptAt: new Date(),
        },
      });
    } catch (err) {
      this.logger.warn(
        `[GalleryCache] Could not finalize job for lot ${lotNumber}: ${(err as Error).message}`,
      );
    }
  }

  private async getConfig(): Promise<{
    maxAttempts: number;
    concurrency: number;
    concurrentLots: number;
    perSequenceDelayMs: number;
  }> {
    try {
      const cfg = await this.prisma.imageScrapeConfig.findUnique({
        where: { id: 'singleton' },
      });
      return {
        maxAttempts: cfg?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        concurrency: cfg?.concurrency ?? DEFAULT_CONCURRENCY,
        concurrentLots: cfg?.concurrentLots ?? DEFAULT_CONCURRENT_LOTS,
        perSequenceDelayMs: cfg?.perSequenceDelayMs ?? 0,
      };
    } catch {
      return {
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
        concurrency: DEFAULT_CONCURRENCY,
        concurrentLots: DEFAULT_CONCURRENT_LOTS,
        perSequenceDelayMs: 0,
      };
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
