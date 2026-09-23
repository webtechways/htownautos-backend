import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type SocialFeed, type SocialFeedItem } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { CreateFeedDto, FeedItemsQueryDto } from './dto';
import { fetchAndParseFeed, persistFeedItems } from './feeds/feed-sync';

/** Verbatim shape of contract.ts `Paginated<T>`. */
export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SocialFeedView {
  id: string;
  url: string;
  title: string | null;
  siteUrl: string | null;
  lastFetchedAt: string | null;
  lastError: string | null;
  itemCount: number;
}

export interface SocialFeedItemView {
  id: string;
  feedId: string;
  title: string;
  link: string;
  summary: string | null;
  imageUrl: string | null;
  publishedAt: string | null;
}

type FeedWithCount = SocialFeed & { _count: { items: number } };

function toView(feed: FeedWithCount): SocialFeedView {
  return {
    id: feed.id,
    url: feed.url,
    title: feed.title,
    siteUrl: feed.siteUrl,
    lastFetchedAt: feed.lastFetchedAt?.toISOString() ?? null,
    lastError: feed.lastError,
    itemCount: feed._count.items,
  };
}

function toItemView(item: SocialFeedItem): SocialFeedItemView {
  return {
    id: item.id,
    feedId: item.feedId,
    title: item.title,
    link: item.link,
    summary: item.summary,
    imageUrl: item.imageUrl,
    publishedAt: item.publishedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class SocialFeedsService {
  private readonly logger = new Logger(SocialFeedsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string): Promise<SocialFeedView[]> {
    const rows = await this.prisma.socialFeed.findMany({ where: { tenantId }, include: { _count: { select: { items: true } } }, orderBy: { createdAt: 'desc' } });
    return rows.map(toView);
  }

  /** Fetches + parses BEFORE writing anything — a feed that doesn't validate is never saved. */
  async create(tenantId: string, dto: CreateFeedDto): Promise<SocialFeedView> {
    const parsed = await fetchAndParseFeed(dto.url);

    let feed: SocialFeed;
    try {
      feed = await this.prisma.socialFeed.create({
        data: { tenantId, url: dto.url, title: parsed.title, siteUrl: parsed.siteUrl, lastFetchedAt: new Date() },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictException('Este feed ya esta agregado');
      throw err;
    }

    await persistFeedItems(this.prisma, tenantId, feed.id, parsed.items);
    return this.getView(feed.id, tenantId);
  }

  async update(tenantId: string, id: string, dto: CreateFeedDto): Promise<SocialFeedView> {
    await this.ensureFeed(id, tenantId);
    const parsed = await fetchAndParseFeed(dto.url);
    try {
      await this.prisma.socialFeed.update({ where: { id }, data: { url: dto.url, title: parsed.title, siteUrl: parsed.siteUrl, lastFetchedAt: new Date(), lastError: null } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictException('Este feed ya esta agregado');
      throw err;
    }
    await persistFeedItems(this.prisma, tenantId, id, parsed.items);
    return this.getView(id, tenantId);
  }

  async remove(tenantId: string, id: string): Promise<{ id: string }> {
    await this.ensureFeed(id, tenantId);
    await this.prisma.socialFeed.delete({ where: { id } });
    return { id };
  }

  /** Interactive refresh — never throws for a fetch/parse failure, records it in `lastError` instead (same contract as the data-sync cron). */
  async refresh(tenantId: string, id: string): Promise<SocialFeedView> {
    const feed = await this.ensureFeed(id, tenantId);
    try {
      const parsed = await fetchAndParseFeed(feed.url);
      await this.prisma.socialFeed.update({ where: { id }, data: { title: parsed.title, siteUrl: parsed.siteUrl, lastFetchedAt: new Date(), lastError: null } });
      await persistFeedItems(this.prisma, tenantId, id, parsed.items);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Feed ${id} refresh failed: ${message}`);
      await this.prisma.socialFeed.update({ where: { id }, data: { lastFetchedAt: new Date(), lastError: message.slice(0, 500) } });
    }
    return this.getView(id, tenantId);
  }

  async listItems(tenantId: string, query: FeedItemsQueryDto): Promise<Paginated<SocialFeedItemView>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.SocialFeedItemWhereInput = { tenantId, ...(query.feedId && { feedId: query.feedId }) };

    const [rows, total] = await Promise.all([
      this.prisma.socialFeedItem.findMany({ where, orderBy: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }], skip: (page - 1) * limit, take: limit }),
      this.prisma.socialFeedItem.count({ where }),
    ]);

    return { data: rows.map(toItemView), total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }

  private async getView(id: string, tenantId: string): Promise<SocialFeedView> {
    const feed = await this.prisma.socialFeed.findFirst({ where: { id, tenantId }, include: { _count: { select: { items: true } } } });
    if (!feed) throw new NotFoundException('Feed no encontrado');
    return toView(feed);
  }

  private async ensureFeed(id: string, tenantId: string): Promise<SocialFeed> {
    const feed = await this.prisma.socialFeed.findFirst({ where: { id, tenantId } });
    if (!feed) throw new NotFoundException('Feed no encontrado');
    return feed;
  }
}
