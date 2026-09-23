import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Prisma, SocialAccount, SocialPostTarget } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { SocialTokenService, metricsAdapterFor, type PostMetricsResult, type SocialPlatform } from '@htownautos/social';

/** Post metrics only refresh for targets published within this window (CONTRACT.md §4 "Metrics" row). */
const POST_METRICS_WINDOW_DAYS = 30;

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Metrics jobs (CONTRACT.md §4 "Metrics" row): account daily snapshot at
 * 03:00 America/Chicago (upserts `SocialAccountMetricDaily`), post metrics
 * every 6h for targets published in the last 30 days (writes
 * `SocialPostTarget.metrics` + `metricsUpdatedAt`). Per-account/per-target
 * errors are logged and skipped — never abort the batch, mirroring
 * `CommunityPollService`. `POST /social/insights/sync` (api, B7) calls
 * `snapshotAccount`/`refreshTarget` directly (interactive path, same
 * pattern as `SocialFeedsService.refresh` running the feed fetch inline
 * instead of round-tripping through a queue).
 */
@Injectable()
export class SocialMetricsJobsService {
  private readonly logger = new Logger(SocialMetricsJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: SocialTokenService,
  ) {}

  @Cron('0 3 * * *', { timeZone: 'America/Chicago' })
  async snapshotAccountsDaily(): Promise<void> {
    const accounts = await this.prisma.socialAccount.findMany({
      where: { status: 'active', isActive: true, publishMethod: 'api' },
    });
    let ok = 0;
    let failed = 0;
    for (const account of accounts) {
      try {
        await this.snapshotAccount(account, todayIsoDate());
        ok++;
      } catch (err) {
        failed++;
        this.logger.warn(`snapshotAccountsDaily: account=${account.id} platform=${account.platform} — ${(err as Error).message}`);
      }
    }
    this.logger.log(`snapshotAccountsDaily: ok=${ok} failed=${failed}`);
  }

  /** Snapshots one account for `date` (`YYYY-MM-DD`). Throws on failure — callers decide whether to catch. */
  async snapshotAccount(account: SocialAccount, date: string): Promise<void> {
    const adapter = metricsAdapterFor(account.platform as SocialPlatform);
    if (!adapter) return;

    const accessToken = await this.tokens.getAccessToken(account);
    const secrets = await this.tokens.getSecrets(account);
    if (!secrets) return;

    const daily = await adapter.accountDaily({ account, accessToken, secrets }, date);
    const day = new Date(`${date}T00:00:00Z`);

    await this.prisma.socialAccountMetricDaily.upsert({
      where: { accountId_date: { accountId: account.id, date: day } },
      create: { tenantId: account.tenantId, accountId: account.id, date: day, ...daily },
      update: { ...daily },
    });
  }

  @Cron(CronExpression.EVERY_6_HOURS)
  async refreshPostMetrics(): Promise<void> {
    const since = new Date(Date.now() - POST_METRICS_WINDOW_DAYS * 86_400_000);
    const targets = await this.prisma.socialPostTarget.findMany({
      where: { status: 'published', publishedAt: { gte: since }, externalId: { not: null } },
      include: { account: true },
    });
    let ok = 0;
    let failed = 0;
    for (const target of targets) {
      try {
        await this.refreshTarget(target);
        ok++;
      } catch (err) {
        failed++;
        this.logger.warn(`refreshPostMetrics: target=${target.id} platform=${target.account.platform} — ${(err as Error).message}`);
      }
    }
    this.logger.log(`refreshPostMetrics: ok=${ok} failed=${failed}`);
  }

  /** Refreshes one target's metrics. Throws on failure — callers decide whether to catch. */
  async refreshTarget(target: SocialPostTarget & { account: SocialAccount }): Promise<void> {
    const account = target.account;
    if (account.status !== 'active' || !account.isActive) return;

    const adapter = metricsAdapterFor(account.platform as SocialPlatform);
    if (!adapter) return;

    const accessToken = await this.tokens.getAccessToken(account);
    const secrets = await this.tokens.getSecrets(account);
    if (!secrets) return;

    const result = await adapter.postMetrics({ account, accessToken, secrets }, target);

    // Prefer our own tracked link clicks (per-target ShortUrl rows) over the platform's own click metric — CONTRACT.md §3.10.
    const shortUrlClicks = await this.prisma.shortUrl.aggregate({
      where: { socialPostTargetId: target.id },
      _sum: { clicks: true },
    });
    const linkClicks = shortUrlClicks._sum.clicks ?? 0;
    const merged: PostMetricsResult = { ...result, clicks: linkClicks > 0 ? linkClicks : result.clicks };

    await this.prisma.socialPostTarget.update({
      where: { id: target.id },
      data: { metrics: merged as unknown as Prisma.InputJsonValue, metricsUpdatedAt: new Date() },
    });
  }
}
