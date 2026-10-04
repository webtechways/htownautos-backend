import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { inIaaiWindow, nextScheduledStart } from '@htownautos/common';
import { UpdateIaaiScraperConfigDto } from './iaai-scraper.dto';

const ACTIVE = ['queued', 'running'];

@Injectable()
export class IaaiScraperService {
  constructor(private readonly prisma: PrismaService) {}

  private config() {
    return this.prisma.iaaiScraperConfig.upsert({ where: { id: 'singleton' }, create: {}, update: {} });
  }

  async status() {
    const cfg = await this.config();
    const now = new Date();
    const [current, lastRuns, lastStart, listings, images] = await Promise.all([
      this.prisma.iaaiScrapeRun.findFirst({ where: { status: { in: ACTIVE } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.iaaiScrapeRun.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
      this.prisma.iaaiScrapeRun.findFirst({ where: { startedAt: { not: null } }, orderBy: { startedAt: 'desc' }, select: { startedAt: true } }),
      this.prisma.iaaiListing.groupBy({ by: ['isActive'], _count: { _all: true } }),
      this.prisma.iaaiListing.groupBy({ by: ['imagesStatus'], _count: { _all: true } }),
    ]);
    const lastCompleted = await this.prisma.iaaiScrapeRun.findFirst({ where: { status: 'completed' }, orderBy: { finishedAt: 'desc' } });
    const interrupted = await this.prisma.iaaiScrapeRun.findFirst({ where: { status: 'interrupted' }, orderBy: { createdAt: 'desc' } });

    const active = listings.find((l) => l.isActive)?._count._all ?? 0;
    const inactive = listings.find((l) => !l.isActive)?._count._all ?? 0;
    const byImages = Object.fromEntries(images.map((g) => [g.imagesStatus, g._count._all]));
    // Photos actually copied (a lot may keep fewer than IAAI lists: per-lot cap, partial failures).
    const [{ n: photosDone }] = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT COALESCE(SUM(("images"->>'imageCount')::int), 0)::int AS n
      FROM "iaai_listings" WHERE "images" IS NOT NULL AND jsonb_typeof("images") = 'object'`;

    // A heartbeat older than 3 min means the worker is not actually on it.
    const stalled = current?.status === 'running' && current.heartbeatAt && now.getTime() - current.heartbeatAt.getTime() > 3 * 60_000;

    return {
      config: cfg,
      now,
      inWindow: inIaaiWindow(cfg, now),
      nextScheduledAt: this.nextStart(cfg, now, !!current, interrupted, lastStart?.startedAt ?? null),
      current: current ? { ...current, stalled: !!stalled } : null,
      interrupted,
      lastCompleted,
      recentRuns: lastRuns,
      listings: { total: active + inactive, active, inactive },
      images: {
        none: byImages.none ?? 0,
        pending: byImages.pending ?? 0,
        processing: byImages.processing ?? 0,
        done: byImages.done ?? 0,
        failed: byImages.failed ?? 0,
        photosDone,
      },
    };
  }

  /** When the worker will next start (or resume) a pass on its own. */
  private nextStart(cfg: Prisma.IaaiScraperConfigGetPayload<{}>, now: Date, busy: boolean, interrupted: unknown, lastStart: Date | null): Date | null {
    if (cfg.paused || busy || cfg.scheduleMode === 'manual') return null;
    if (interrupted) {
      // An interrupted pass resumes as soon as the window is open again.
      if (cfg.scheduleMode !== 'window' || inIaaiWindow(cfg, now)) return now;
      return nextScheduledStart({ ...cfg, intervalHours: 0 }, now, null);
    }
    return nextScheduledStart(cfg, now, lastStart);
  }

  async updateConfig(dto: UpdateIaaiScraperConfigDto) {
    if (dto.timezone) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: dto.timezone });
      } catch {
        throw new BadRequestException(`Unknown time zone: ${dto.timezone}`);
      }
    }
    if (dto.daysOfWeek) dto.daysOfWeek = [...new Set(dto.daysOfWeek)].sort();
    await this.config();
    const cfg = await this.prisma.iaaiScraperConfig.update({ where: { id: 'singleton' }, data: dto });
    if (cfg.pageDelayMaxMs < cfg.pageDelayMinMs) {
      return this.prisma.iaaiScraperConfig.update({ where: { id: 'singleton' }, data: { pageDelayMaxMs: cfg.pageDelayMinMs } });
    }
    return cfg;
  }

  /** Queue a manual pass and un-pause. One pass at a time. */
  async start(maxRunMinutes: number | undefined, requestedBy: string | null) {
    const active = await this.prisma.iaaiScrapeRun.findFirst({ where: { status: { in: ACTIVE } } });
    if (active) throw new BadRequestException('A pass is already queued or running');
    await this.config();
    await this.prisma.iaaiScraperConfig.update({ where: { id: 'singleton' }, data: { paused: false } });
    // An interrupted pass is abandoned: Start means "from the beginning, now".
    await this.prisma.iaaiScrapeRun.updateMany({
      where: { status: 'interrupted' },
      data: { status: 'stopped', message: 'Superseded by a manual start', finishedAt: new Date() },
    });
    return this.prisma.iaaiScrapeRun.create({
      data: { trigger: 'manual', status: 'queued', maxRunMinutes: maxRunMinutes || null, requestedBy },
    });
  }

  /** Ask the worker to stop between pages; a queued pass is cancelled outright. */
  async stop() {
    const cancelled = await this.prisma.iaaiScrapeRun.updateMany({
      where: { status: { in: ['queued', 'interrupted'] } },
      data: { status: 'stopped', message: 'Stopped from Settings', finishedAt: new Date() },
    });
    const running = await this.prisma.iaaiScrapeRun.updateMany({ where: { status: 'running' }, data: { stopRequested: true } });
    return { cancelled: cancelled.count, stopping: running.count };
  }

  async runs(page: number, limit: number) {
    const take = Math.min(100, Math.max(1, limit));
    const [total, data] = await Promise.all([
      this.prisma.iaaiScrapeRun.count(),
      this.prisma.iaaiScrapeRun.findMany({ orderBy: { createdAt: 'desc' }, skip: (Math.max(1, page) - 1) * take, take }),
    ]);
    return { data, total, page, limit: take };
  }

  async listings(q: { search?: string; active?: string; images?: string; page: number; limit: number }) {
    const take = Math.min(100, Math.max(1, q.limit));
    const term = q.search?.trim();
    const where: Prisma.IaaiListingWhereInput = {
      ...(q.active === 'true' && { isActive: true }),
      ...(q.active === 'false' && { isActive: false }),
      ...(q.images && { imagesStatus: q.images }),
      ...(term && {
        OR: [
          { stockNumber: { contains: term } },
          { vin: { contains: term.toUpperCase() } },
          { make: { contains: term, mode: 'insensitive' } },
          { model: { contains: term, mode: 'insensitive' } },
          { branchName: { contains: term, mode: 'insensitive' } },
        ],
      }),
    };
    const [total, data] = await Promise.all([
      this.prisma.iaaiListing.count({ where }),
      this.prisma.iaaiListing.findMany({
        where,
        orderBy: [{ auctionAt: { sort: 'asc', nulls: 'last' } }, { stockNumber: 'asc' }],
        skip: (Math.max(1, q.page) - 1) * take,
        take,
        select: {
          stockNumber: true, vin: true, year: true, make: true, model: true, primaryDamage: true, odometer: true,
          saleDocument: true, branchName: true, branchCode: true, locationCity: true, locationState: true,
          auctionAt: true, currentBid: true, buyNowPrice: true, acv: true, isActive: true,
          imageCount: true, images: true, imagesStatus: true, imagesError: true, lastSeenAt: true,
          yard: { select: { name: true, slug: true } },
        },
      }),
    ]);
    return {
      data: data.map(({ images, ...l }) => ({ ...l, thumbnail: (images as { images?: { thumbnail?: string }[] } | null)?.images?.[0]?.thumbnail ?? null })),
      total,
      page: q.page,
      limit: take,
    };
  }

  /** Photos are downloaded by the image cache: put its failed IAAI jobs back in line. */
  async retryFailedImages() {
    const res = await this.prisma.imageCacheJob.updateMany({
      where: { auction: 'IAAI', status: 'failed' },
      data: { status: 'pending', attempts: 0, lastError: null, failedSequences: Prisma.DbNull },
    });
    await this.prisma.iaaiListing.updateMany({ where: { imagesStatus: 'failed' }, data: { imagesStatus: 'pending', imagesError: null } });
    return { requeued: res.count };
  }
}
