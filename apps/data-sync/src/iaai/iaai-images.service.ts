import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { ProxyService, PublicS3Service } from '@htownautos/common';

/** A lot claimed longer ago than this was abandoned by a dead worker. */
const STALE_CLAIM_MS = 15 * 60_000;
const IMAGE_TIMEOUT_MS = 30_000;

/**
 * Copies the photos of scraped IAAI lots to our public bucket, served from
 * img.htownautos.com under `iaai/<stockNumber>/<n>.jpg`.
 *
 * Every minute it claims `imageLotsPerTick` lots in `pending`, soonest auction
 * first, and downloads their photos `imageConcurrency` at a time. A lot whose
 * photos all fail goes back to `pending` until `imageMaxAttempts`, then
 * `failed` (retried from the UI). Partial success keeps what downloaded.
 */
@Injectable()
export class IaaiImagesService {
  private readonly logger = new Logger(IaaiImagesService.name);
  private busy = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: PublicS3Service,
    private readonly proxy: ProxyService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const cfg = await this.prisma.iaaiScraperConfig.findUnique({ where: { id: 'singleton' } });
      if (!cfg || cfg.paused || !cfg.downloadImages) return;

      await this.prisma.iaaiListing.updateMany({
        where: { imagesStatus: 'processing', imagesClaimedAt: { lt: new Date(Date.now() - STALE_CLAIM_MS) } },
        data: { imagesStatus: 'pending' },
      });

      const where: Prisma.IaaiListingWhereInput = {
        imagesStatus: 'pending',
        isActive: true,
        ...(cfg.imagesOnlyUpcoming && { OR: [{ auctionAt: null }, { auctionAt: { gt: new Date() } }] }),
      };
      const lots = await this.prisma.iaaiListing.findMany({
        where,
        orderBy: [{ auctionAt: { sort: 'asc', nulls: 'last' } }, { firstSeenAt: 'asc' }],
        take: Math.min(200, Math.max(1, cfg.imageLotsPerTick)),
        select: { stockNumber: true, imageSourceUrls: true, imagesAttempts: true },
      });
      if (!lots.length) return;

      // Claim them so a slow tick and the next one never take the same lot.
      await this.prisma.iaaiListing.updateMany({
        where: { stockNumber: { in: lots.map((l) => l.stockNumber) }, imagesStatus: 'pending' },
        data: { imagesStatus: 'processing', imagesClaimedAt: new Date() },
      });

      for (const lot of lots) {
        const fresh = await this.prisma.iaaiScraperConfig.findUnique({ where: { id: 'singleton' }, select: { paused: true, downloadImages: true } });
        if (!fresh || fresh.paused || !fresh.downloadImages) {
          await this.prisma.iaaiListing.updateMany({ where: { stockNumber: lot.stockNumber, imagesStatus: 'processing' }, data: { imagesStatus: 'pending' } });
          continue;
        }
        await this.copyLot(lot, cfg);
      }
    } catch (err) {
      this.logger.error(`[IaaiImages] tick failed: ${(err as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  private async copyLot(
    lot: { stockNumber: string; imageSourceUrls: Prisma.JsonValue; imagesAttempts: number },
    cfg: { imageConcurrency: number; imageMaxPerLot: number; imageMaxAttempts: number; useProxy: boolean },
  ): Promise<void> {
    let urls = Array.isArray(lot.imageSourceUrls) ? (lot.imageSourceUrls as string[]).filter((u) => typeof u === 'string') : [];
    if (cfg.imageMaxPerLot > 0) urls = urls.slice(0, cfg.imageMaxPerLot);
    if (!urls.length) {
      await this.prisma.iaaiListing.update({ where: { stockNumber: lot.stockNumber }, data: { imagesStatus: 'none', images: Prisma.DbNull } });
      return;
    }

    const out: (string | null)[] = new Array(urls.length).fill(null);
    let lastError: string | null = null;
    let next = 0;
    const worker = async () => {
      while (next < urls.length) {
        const i = next++;
        try {
          out[i] = await this.copyOne(urls[i], `iaai/${lot.stockNumber}/${i + 1}.jpg`, cfg.useProxy);
        } catch (err) {
          lastError = (err as Error).message.slice(0, 300);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(urls.length, Math.max(1, cfg.imageConcurrency)) }, worker));

    const saved = out.filter((u): u is string => !!u);
    const attempts = lot.imagesAttempts + 1;
    if (saved.length) {
      await this.prisma.iaaiListing.update({
        where: { stockNumber: lot.stockNumber },
        data: {
          images: saved,
          imagesStatus: 'done',
          imagesAttempts: attempts,
          imagesError: saved.length < urls.length ? `${urls.length - saved.length} of ${urls.length} failed: ${lastError}` : null,
          imagesUpdatedAt: new Date(),
        },
      });
      return;
    }
    await this.prisma.iaaiListing.update({
      where: { stockNumber: lot.stockNumber },
      data: { imagesStatus: attempts >= cfg.imageMaxAttempts ? 'failed' : 'pending', imagesAttempts: attempts, imagesError: lastError },
    });
  }

  private async copyOne(url: string, key: string, useProxy: boolean): Promise<string> {
    const res = useProxy
      ? await this.proxy.fetchViaProxy(url, { maxAttempts: 3, timeoutMs: IMAGE_TIMEOUT_MS })
      : await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', Accept: 'image/*' }, signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) throw new Error(`Not an image (${type || 'no type'}) for ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 500) throw new Error(`Image too small (${buf.length} B) for ${url}`);
    await this.s3.uploadBufferToKey(buf, key, type);
    return this.s3.buildPublicUrl(key);
  }
}
