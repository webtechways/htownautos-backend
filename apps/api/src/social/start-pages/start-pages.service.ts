import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, SocialStartPage } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { MediaResolverService } from '@htownautos/social';
import { StartPageInputDto, StartPageStatsQueryDto } from './dto';
import { DEFAULT_THEME, toBlocks, toStartPageView, type StartPageView } from './mappers';
import { isReservedSlug, slugify, validateSlugShape } from './slug.util';

const MAX_SLUG_SUFFIX_ATTEMPTS = 30;
const DEFAULT_STATS_WINDOW_DAYS = 30;

export interface StartPageStatsView {
  views: number;
  clicks: number;
  /** 0..1 */
  ctr: number;
  series: { date: string; views: number; clicks: number }[];
  byBlock: { blockId: string; label: string | null; clicks: number }[];
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Start pages ("link in bio") — CRUD, publish/unpublish, stats (CONTRACT.md §3.9). */
@Injectable()
export class SocialStartPagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaResolver: MediaResolverService,
  ) {}

  async list(tenantId: string): Promise<StartPageView[]> {
    const pages = await this.prisma.socialStartPage.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    return Promise.all(pages.map((p) => toStartPageView(this.prisma, this.mediaResolver, tenantId, p)));
  }

  async get(tenantId: string, id: string): Promise<StartPageView> {
    const page = await this.ensurePage(id, tenantId);
    return toStartPageView(this.prisma, this.mediaResolver, tenantId, page);
  }

  async create(tenantId: string, dto: StartPageInputDto): Promise<StartPageView> {
    const title = dto.title?.trim() || 'Mi página';
    const slug = dto.slug ? dto.slug.toLowerCase() : await this.generateSlug(title);
    validateSlugShape(slug);
    await this.ensureSlugAvailable(slug);

    const page = await this.prisma.socialStartPage.create({
      data: {
        tenantId,
        slug,
        title,
        bio: dto.bio ?? null,
        avatarMediaId: dto.avatarMediaId ?? null,
        theme: (dto.theme ?? DEFAULT_THEME) as unknown as Prisma.InputJsonValue,
        blocks: (dto.blocks ?? []) as unknown as Prisma.InputJsonValue,
      },
    });
    return toStartPageView(this.prisma, this.mediaResolver, tenantId, page);
  }

  async update(tenantId: string, id: string, dto: StartPageInputDto): Promise<StartPageView> {
    const existing = await this.ensurePage(id, tenantId);

    let slug: string | undefined;
    if (dto.slug !== undefined && dto.slug.toLowerCase() !== existing.slug) {
      slug = dto.slug.toLowerCase();
      validateSlugShape(slug);
      await this.ensureSlugAvailable(slug, id);
    }

    const data: Prisma.SocialStartPageUpdateInput = {};
    if (slug !== undefined) data.slug = slug;
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.bio !== undefined) data.bio = dto.bio;
    if (dto.avatarMediaId !== undefined) data.avatarMediaId = dto.avatarMediaId;
    if (dto.theme !== undefined) data.theme = dto.theme as unknown as Prisma.InputJsonValue;
    if (dto.blocks !== undefined) data.blocks = dto.blocks as unknown as Prisma.InputJsonValue;

    const page = await this.prisma.socialStartPage.update({ where: { id }, data });
    return toStartPageView(this.prisma, this.mediaResolver, tenantId, page);
  }

  async remove(tenantId: string, id: string): Promise<{ id: string }> {
    await this.ensurePage(id, tenantId);
    await this.prisma.socialStartPage.delete({ where: { id } });
    return { id };
  }

  async publish(tenantId: string, id: string): Promise<StartPageView> {
    await this.ensurePage(id, tenantId);
    const page = await this.prisma.socialStartPage.update({ where: { id }, data: { published: true } });
    return toStartPageView(this.prisma, this.mediaResolver, tenantId, page);
  }

  async unpublish(tenantId: string, id: string): Promise<StartPageView> {
    await this.ensurePage(id, tenantId);
    const page = await this.prisma.socialStartPage.update({ where: { id }, data: { published: false } });
    return toStartPageView(this.prisma, this.mediaResolver, tenantId, page);
  }

  async stats(tenantId: string, id: string, query: StartPageStatsQueryDto): Promise<StartPageStatsView> {
    const page = await this.ensurePage(id, tenantId);
    const to = query.to ? new Date(`${query.to}T00:00:00Z`) : new Date(new Date().toISOString().slice(0, 10));
    const from = query.from ? new Date(`${query.from}T00:00:00Z`) : new Date(to.getTime() - DEFAULT_STATS_WINDOW_DAYS * 86_400_000);

    const rows = await this.prisma.socialStartPageStat.findMany({
      where: { tenantId, pageId: id, date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
    });

    const seriesAgg = new Map<string, { views: number; clicks: number }>();
    let totalViews = 0;
    let totalClicks = 0;
    const byBlockAgg = new Map<string, number>();

    for (const row of rows) {
      const key = dateKey(row.date);
      const agg = seriesAgg.get(key) ?? { views: 0, clicks: 0 };
      if (row.blockId === '') {
        agg.views += row.views;
        totalViews += row.views;
      }
      agg.clicks += row.clicks;
      totalClicks += row.clicks;
      seriesAgg.set(key, agg);

      if (row.blockId !== '') {
        byBlockAgg.set(row.blockId, (byBlockAgg.get(row.blockId) ?? 0) + row.clicks);
      }
    }

    const blockLabels = new Map(toBlocks(page.blocks).map((b) => [b.id, b.label ?? null]));
    const series = Array.from(seriesAgg.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, agg]) => ({ date, views: agg.views, clicks: agg.clicks }));
    const byBlock = Array.from(byBlockAgg.entries()).map(([blockId, clicks]) => ({ blockId, label: blockLabels.get(blockId) ?? null, clicks }));

    return {
      views: totalViews,
      clicks: totalClicks,
      ctr: totalViews > 0 ? Math.min(1, totalClicks / totalViews) : 0,
      series,
      byBlock,
    };
  }

  private async ensurePage(id: string, tenantId: string): Promise<SocialStartPage> {
    const page = await this.prisma.socialStartPage.findFirst({ where: { id, tenantId } });
    if (!page) throw new NotFoundException('Start page no encontrada');
    return page;
  }

  private async ensureSlugAvailable(slug: string, excludeId?: string): Promise<void> {
    const existing = await this.prisma.socialStartPage.findUnique({ where: { slug } });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`El slug "${slug}" ya está en uso — elige otro`);
    }
  }

  private async generateSlug(title: string): Promise<string> {
    const base = slugify(title);
    for (let i = 0; i < MAX_SLUG_SUFFIX_ATTEMPTS; i++) {
      const candidate = i === 0 ? base : `${base}-${i + 1}`.slice(0, 40);
      if (isReservedSlug(candidate)) continue;
      const existing = await this.prisma.socialStartPage.findUnique({ where: { slug: candidate } });
      if (!existing) return candidate;
    }
    // Extremely unlikely fallback — a short random suffix guarantees termination.
    return `${base}-${Math.random().toString(36).slice(2, 8)}`.slice(0, 40);
  }
}
