import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@htownautos/prisma';
import { fetchAndParseFeed, persistFeedItems } from './feeds/feed-sync';

/**
 * Refreshes every tenant's RSS/Atom feeds (contract.ts §3.5 "data-sync cron
 * every 30 min refreshing all feeds"). Mirrors `feeds.service.ts#refresh` in
 * apps/api (same SSRF guard + parser, duplicated on purpose — Nx apps don't
 * import each other's src). A single feed's failure is recorded on its own
 * `lastError` and never stops the batch or crashes the process.
 */
@Injectable()
export class SocialFeedsRefreshService {
  private readonly logger = new Logger(SocialFeedsRefreshService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async refreshAllFeeds(): Promise<void> {
    const feeds = await this.prisma.socialFeed.findMany({ select: { id: true, tenantId: true, url: true } });
    if (feeds.length === 0) return;

    this.logger.log(`Refreshing ${feeds.length} social feed(s)`);
    let ok = 0;
    let failed = 0;
    for (const feed of feeds) {
      try {
        const parsed = await fetchAndParseFeed(feed.url);
        await this.prisma.socialFeed.update({ where: { id: feed.id }, data: { title: parsed.title, siteUrl: parsed.siteUrl, lastFetchedAt: new Date(), lastError: null } });
        await persistFeedItems(this.prisma, feed.tenantId, feed.id, parsed.items);
        ok++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Feed ${feed.id} refresh failed: ${message}`);
        await this.prisma.socialFeed.update({ where: { id: feed.id }, data: { lastFetchedAt: new Date(), lastError: message.slice(0, 500) } }).catch(() => undefined);
        failed++;
      }
    }
    this.logger.log(`Social feeds refresh done: ${ok} ok, ${failed} failed`);
  }
}
