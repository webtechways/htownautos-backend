import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { PublicS3Service } from '@htownautos/common';
import { ProxySyncService } from '../proxy-sync/proxy-sync.service';
import { UpdateImageScrapeConfigDto } from './dto/update-image-scrape-config.dto';

const CONFIG_ID = 'singleton';
// Re-list the gallery/ prefix at most this often (storage changes slowly).
// Recorrer gallery/ son >2.000 llamadas de listado; el tamaño cambia despacio.
const STORAGE_TTL_MS = 6 * 60 * 60_000;
const GALLERY_PREFIX = 'gallery/';

const DEFAULT_CONFIG = {
  id: CONFIG_ID,
  paused: false,
  lotsPerTick: 6,
  maxAttempts: 5,
  perSequenceDelayMs: 0,
  concurrency: 4,
  concurrentLots: 1,
  proxyResyncHours: 168,
  proxyLastSyncAt: null as Date | null,
  retentionDays: 0,
  retentionLastRunAt: null as Date | null,
  retentionDeletedLots: 0,
  retentionLastError: null as string | null,
  storageBytes: null as bigint | null,
  storageObjects: null as number | null,
  storageComputedAt: null as Date | null,
};

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

function clampPage(page?: number, limit?: number) {
  const p = Math.max(1, Math.floor(Number(page) || 1));
  const l = Math.min(100, Math.max(1, Math.floor(Number(limit) || 25)));
  return { p, l, skip: (p - 1) * l };
}

/**
 * Control plane for the image scraping/caching subsystem (global, staff-only).
 * The data-sync crawler reads {@link getConfig} every tick; this service only
 * reads/writes the queue + config + proxy inventory for the Settings UI.
 */
@Injectable()
export class ImageCacheService {
  private readonly logger = new Logger(ImageCacheService.name);

  // Cached S3 storage total for the gallery/ prefix (refreshed in the background).
  private storageBytes = 0;
  private storageObjects = 0;
  private storageComputedAt: Date | null = null;
  private storageComputing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly proxySync: ProxySyncService,
    // Las galerías viven en el bucket PÚBLICO; el perfil por defecto es el
    // privado y ahí no existe el prefijo gallery/ (el tile marcaba 0 GB).
    private readonly s3: PublicS3Service,
  ) {}

  /** Manually pull the current Webshare proxy list and refresh the inventory. */
  async resyncProxies() {
    return this.proxySync.syncProxies();
  }

  async getConfig() {
    const cfg = await this.prisma.imageScrapeConfig.findUnique({ where: { id: CONFIG_ID } });
    return cfg ?? DEFAULT_CONFIG;
  }

  async updateConfig(dto: UpdateImageScrapeConfigDto) {
    return this.prisma.imageScrapeConfig.upsert({
      where: { id: CONFIG_ID },
      update: { ...dto },
      create: { id: CONFIG_ID, ...dto },
    });
  }

  /** Live counters + config for the control panel. */
  async getStatus() {
    const [grouped, cachedCount, config] = await Promise.all([
      this.prisma.imageCacheJob.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.auctionListing.count({ where: { galleryCachedAt: { not: null } } }),
      this.getConfig(),
    ]);

    // Preview for the retention control: how many galleries are past the cutoff
    // today. Staff can see the blast radius before switching it on.
    const retentionEligible = await this.countRetentionEligible(config.retentionDays);

    const counts = { pending: 0, processing: 0, done: 0, failed: 0 } as Record<string, number>;
    for (const g of grouped) counts[g.status] = g._count._all;

    // Tick runs every minute → ETA ≈ pending / lotsPerTick minutes.
    const perTick = config.lotsPerTick || 1;
    const etaMinutes = Math.ceil(counts.pending / perTick);

    // El proceso puede haber reiniciado: parte del último valor guardado para no
    // mostrar un hueco mientras se recalcula (el listado tarda minutos).
    if (!this.storageComputedAt && config.storageComputedAt) {
      this.storageBytes = Number(config.storageBytes ?? 0);
      this.storageObjects = config.storageObjects ?? 0;
      this.storageComputedAt = config.storageComputedAt;
    }

    // Refresh the S3 storage total in the background (throttled); never blocks.
    this.maybeRefreshStorage();

    return {
      counts,
      queueDepth: counts.pending + counts.processing,
      cachedListings: cachedCount,
      etaMinutes,
      storageBytes: this.storageBytes,
      storageObjects: this.storageObjects,
      storageComputedAt: this.storageComputedAt,
      retentionEligible,
      config,
    };
  }

  /**
   * Cached galleries whose sale is older than the retention window. Upper bound:
   * the worker additionally spares lots someone favourited, bid on, grouped,
   * reviewed or analysed, so it will delete this many or fewer.
   */
  private async countRetentionEligible(days: number): Promise<number> {
    if (!days || days <= 0) return 0;
    const d = new Date(Date.now() - days * 86_400_000);
    const cutoffDate =
      d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    // Mirrors ImageRetentionService.eligibleWhere(): sale long past, or the lot
    // dropped out of the Copart feed that long ago (some go stale with a future
    // or missing saleDate).
    return this.prisma.auctionListing.count({
      where: {
        galleryCache: { not: null },
        OR: [
          { saleDate: { not: null, lt: cutoffDate } },
          { isStale: true, updatedAt: { lt: d } },
        ],
      },
    });
  }

  /** Kick off a storage recompute if stale and not already running (non-blocking). */
  private maybeRefreshStorage() {
    if (this.storageComputing) return;
    const fresh =
      this.storageComputedAt &&
      Date.now() - this.storageComputedAt.getTime() < STORAGE_TTL_MS;
    if (fresh) return;

    this.storageComputing = true;
    this.s3
      .sumPrefixSize(GALLERY_PREFIX)
      .then(async ({ bytes, objects }) => {
        this.storageBytes = bytes;
        this.storageObjects = objects;
        this.storageComputedAt = new Date();
        this.logger.log(
          `[Storage] gallery/ = ${(bytes / 1e9).toFixed(2)} GB across ${objects} objects`,
        );
        // Guardarlo para que sobreviva al siguiente despliegue.
        await this.prisma.imageScrapeConfig
          .update({
            where: { id: CONFIG_ID },
            data: {
              storageBytes: BigInt(bytes),
              storageObjects: objects,
              storageComputedAt: this.storageComputedAt,
            },
          })
          .catch(() => undefined);
      })
      .catch((err) => this.logger.warn(`[Storage] compute failed: ${err.message}`))
      .finally(() => {
        this.storageComputing = false;
      });
  }

  async listJobs(params: { status?: string; page?: number; limit?: number }): Promise<Paginated<any>> {
    const { p, l, skip } = clampPage(params.page, params.limit);
    const where: Prisma.ImageCacheJobWhereInput = params.status
      ? { status: params.status }
      : {};

    const [rows, total] = await Promise.all([
      this.prisma.imageCacheJob.findMany({
        where,
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        skip,
        take: l,
      }),
      this.prisma.imageCacheJob.count({ where }),
    ]);

    return { data: rows.map((r) => this.serializeJob(r)), total, page: p, limit: l };
  }

  /** Lots that failed after every retry, or cached with some failed sequences. */
  async listFailures(params: { page?: number; limit?: number }): Promise<Paginated<any>> {
    const { p, l, skip } = clampPage(params.page, params.limit);
    const where: Prisma.ImageCacheJobWhereInput = {
      OR: [{ status: 'failed' }, { failedSequences: { not: Prisma.DbNull } }],
    };

    const [rows, total] = await Promise.all([
      this.prisma.imageCacheJob.findMany({
        where,
        orderBy: { lastAttemptAt: 'desc' },
        skip,
        take: l,
      }),
      this.prisma.imageCacheJob.count({ where }),
    ]);

    return { data: rows.map((r) => this.serializeJob(r)), total, page: p, limit: l };
  }

  /** Re-queue a failed lot so the crawler picks it up again. */
  async retryJob(lotNumberStr: string) {
    const lotNumber = BigInt(lotNumberStr);
    await this.prisma.imageCacheJob.update({
      where: { lotNumber },
      data: {
        status: 'pending',
        lastError: null,
        failedSequences: Prisma.DbNull,
      },
    });
    return { lotNumber: lotNumberStr, status: 'pending' };
  }

  /**
   * Devuelve a la cola los lotes fallidos: los indicados, o todos.
   *
   * `attempts` se pone a cero. El crawler deja de reintentar un lote a partir de
   * cierto numero de intentos, asi que reencolarlo sin resetearlo lo dejaria
   * fallando para siempre — que es justo lo contrario de lo que pide un boton
   * de reintentar.
   */
  /**
   * Re-queue everything still worth retrying: `failed` and `skipped` alike, but
   * only while the auction has not happened yet.
   *
   * The two states look different and are the same problem here. `failed` means
   * the proxies got blocked; `skipped` means Copart answered with zero images —
   * which usually means "no photos yet", since they are published days after a
   * lot is listed. Neither is permanent while the car is still going to sell.
   *
   * Past the sale date it stops being worth it: new photos help nobody once
   * nobody can bid, and re-queueing them spends proxy budget for nothing.
   */
  async requeueRetryable(): Promise<{ requeued: number; failed: number; skipped: number }> {
    const now = new Date();
    const todayInt =
      now.getUTCFullYear() * 10000 + (now.getUTCMonth() + 1) * 100 + now.getUTCDate();

    // Pick up the sale dates Copart assigned after these lots were enqueued;
    // `priority` is a snapshot and would otherwise still read NULL for them.
    await this.prisma.$executeRaw`
      UPDATE image_cache_jobs j
         SET priority = l."saleDate"
        FROM auction_listings l
       WHERE l."lotNumber" = j."lotNumber"
         AND j.priority IS NULL
         AND l."saleDate" IS NOT NULL
    `;

    // `priority` holds the lot's saleDate as YYYYMMDD. A NULL means Copart has
    // listed the lot but not scheduled it ("Future Sale") — it cannot have been
    // auctioned yet, so it is retryable; NULL fails `gte` in SQL, which is what
    // used to drop 27.569 of these jobs on the floor. The age bound keeps the
    // permanent tail (~1,3% never get a date) out of the queue.
    const where: Prisma.ImageCacheJobWhereInput = {
      status: { in: ['failed', 'skipped'] },
      OR: [
        { priority: { gte: todayInt } },
        { priority: null, createdAt: { gt: new Date(Date.now() - 45 * 24 * 3_600_000) } },
      ],
    };

    const [failed, skipped] = await Promise.all([
      this.prisma.imageCacheJob.count({ where: { ...where, status: 'failed' } }),
      this.prisma.imageCacheJob.count({ where: { ...where, status: 'skipped' } }),
    ]);

    const res = await this.prisma.imageCacheJob.updateMany({
      where,
      data: {
        status: 'pending',
        lastError: null,
        attempts: 0,
        failedSequences: Prisma.DbNull,
      },
    });
    this.logger.log(
      `[ImageCache] re-queued ${res.count} lot(s) not yet auctioned ` +
      `(${failed} failed, ${skipped} skipped)`,
    );
    return { requeued: res.count, failed, skipped };
  }

  async retryFailed(lots?: string[]): Promise<{ requeued: number }> {
    const where: Prisma.ImageCacheJobWhereInput = { status: 'failed' };
    if (lots?.length) {
      const ids: bigint[] = [];
      for (const l of lots) {
        try {
          ids.push(BigInt(l));
        } catch {
          // Un lote que no es numero no existe: se ignora en vez de tumbar
          // la peticion entera por una fila mal seleccionada.
        }
      }
      if (!ids.length) return { requeued: 0 };
      where.lotNumber = { in: ids };
    }

    const res = await this.prisma.imageCacheJob.updateMany({
      where,
      data: {
        status: 'pending',
        lastError: null,
        attempts: 0,
        failedSequences: Prisma.DbNull,
      },
    });
    this.logger.log(`[ImageCache] ${res.count} lote(s) devueltos a la cola`);
    return { requeued: res.count };
  }

  /** Recently cached lots (source of truth = AuctionListing.galleryCachedAt). */
  async listCached(params: { page?: number; limit?: number }): Promise<Paginated<any>> {
    const { p, l, skip } = clampPage(params.page, params.limit);
    const where: Prisma.AuctionListingWhereInput = { galleryCachedAt: { not: null } };

    const [rows, total] = await Promise.all([
      this.prisma.auctionListing.findMany({
        where,
        orderBy: { galleryCachedAt: 'desc' },
        skip,
        take: l,
        select: {
          lotNumber: true,
          year: true,
          make: true,
          modelGroup: true,
          galleryCache: true,
          galleryCachedAt: true,
        },
      }),
      this.prisma.auctionListing.count({ where }),
    ]);

    const data = rows.map((r) => ({
      lotNumber: r.lotNumber.toString(),
      year: r.year,
      make: r.make,
      model: r.modelGroup,
      imageCount: this.imageCount(r.galleryCache),
      cachedAt: r.galleryCachedAt,
    }));

    return { data, total, page: p, limit: l };
  }

  /** Full proxy inventory incl. retired (kept across Webshare renewals). */
  async listProxies() {
    const proxies = await this.prisma.proxy.findMany({
      orderBy: [{ isActive: 'desc' }, { retiredAt: 'asc' }, { address: 'asc' }],
      select: {
        id: true,
        address: true,
        port: true,
        country: true,
        city: true,
        status: true,
        isActive: true,
        lastCheckedAt: true,
        lastSeenInFeedAt: true,
        retiredAt: true,
      },
    });
    return { data: proxies, total: proxies.length };
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  private serializeJob(r: {
    lotNumber: bigint;
    status: string;
    priority: number | null;
    attempts: number;
    failedSequences: Prisma.JsonValue;
    lastError: string | null;
    lastAttemptAt: Date | null;
    source: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      lotNumber: r.lotNumber.toString(),
      status: r.status,
      priority: r.priority,
      attempts: r.attempts,
      failedSequences: r.failedSequences ?? null,
      lastError: r.lastError,
      lastAttemptAt: r.lastAttemptAt,
      source: r.source,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  private imageCount(galleryCache: string | null): number {
    if (!galleryCache) return 0;
    try {
      const parsed = JSON.parse(galleryCache) as { imageCount?: number };
      return parsed.imageCount ?? 0;
    } catch {
      return 0;
    }
  }
}
