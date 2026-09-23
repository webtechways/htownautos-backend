import type { PrismaService } from '@htownautos/prisma';
import { assertPublicHttpUrl, fetchPublicUrl } from './ssrf-guard';
import { parseFeed, type ParsedFeed, type ParsedFeedItem } from './feed-parser';

/** Keep the last N items per feed (contract.ts §3.5 "keep last 100 per feed"). */
export const MAX_ITEMS_PER_FEED = 100;

/** SSRF-safe fetch + RSS/Atom parse — throws BadRequestException on any validation failure. */
export async function fetchAndParseFeed(rawUrl: string): Promise<ParsedFeed> {
  const url = await assertPublicHttpUrl(rawUrl);
  const xml = await fetchPublicUrl(url);
  return parseFeed(xml);
}

/** Upserts by (feedId, guid) and trims to the last 100 items (newest `publishedAt` first, nulls last). Returns the resulting item count. */
export async function persistFeedItems(prisma: PrismaService, tenantId: string, feedId: string, items: ParsedFeedItem[]): Promise<number> {
  const toUpsert = items.slice(0, MAX_ITEMS_PER_FEED);
  if (toUpsert.length > 0) {
    await prisma.$transaction(
      toUpsert.map((item) =>
        prisma.socialFeedItem.upsert({
          where: { feedId_guid: { feedId, guid: item.guid } },
          create: { tenantId, feedId, guid: item.guid, title: item.title, link: item.link, summary: item.summary, imageUrl: item.imageUrl, publishedAt: item.publishedAt },
          update: { title: item.title, link: item.link, summary: item.summary, imageUrl: item.imageUrl, publishedAt: item.publishedAt },
        }),
      ),
    );
  }

  const total = await prisma.socialFeedItem.count({ where: { feedId } });
  if (total > MAX_ITEMS_PER_FEED) {
    const stale = await prisma.socialFeedItem.findMany({
      where: { feedId },
      orderBy: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      skip: MAX_ITEMS_PER_FEED,
      select: { id: true },
    });
    if (stale.length > 0) await prisma.socialFeedItem.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  }

  return Math.min(total, MAX_ITEMS_PER_FEED);
}
