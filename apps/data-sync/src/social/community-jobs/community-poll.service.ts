import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Prisma, SocialAccount } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import {
  SocialApiError,
  SocialIngestService,
  SocialNotifierService,
  SocialRealtimeService,
  SocialTokenService,
  communityAdapterFor,
  COMMUNITY_POLL_PLATFORMS,
  COMMUNITY_BACKFILL_PLATFORMS,
  type NormalizedComment,
  type SocialPlatform,
} from '@htownautos/social';

/** How many of the account's most recent published posts we ask per-post platforms (Facebook, Instagram, Threads, LinkedIn) to check for new comments. */
const MAX_POSTS_TRACKED = 25;

function metaOf(account: SocialAccount): Record<string, unknown> {
  const v = account.metaValue;
  return v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};
}

/**
 * Comment/mention/review pollers (CONTRACT.md §4): every 5 min for
 * YouTube/Threads/LinkedIn/Bluesky/Mastodon/X/GBP, every 30 min backfill for
 * Facebook/Instagram (whose primary path is the Meta webhook, owned by B3).
 * Cursor per account lives in `SocialAccount.metaValue.commentsSince` — no
 * schema change, per CONTRACT.md. A `PERMISSION` error (LinkedIn without
 * Community Management approval, X without a paid tier) disables future
 * polls for that account (`metaValue.commentsPollDisabledAt`) instead of
 * retrying — and failing — every cycle forever; reconnecting the account
 * clears it (new `SocialAccount.update` from the connect flow overwrites
 * `metaValue`).
 */
@Injectable()
export class CommunityPollService {
  private readonly logger = new Logger(CommunityPollService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: SocialTokenService,
    private readonly ingest: SocialIngestService,
    private readonly notifier: SocialNotifierService,
    private readonly realtime: SocialRealtimeService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async pollFast(): Promise<void> {
    await this.pollPlatforms(COMMUNITY_POLL_PLATFORMS);
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async pollBackfill(): Promise<void> {
    await this.pollPlatforms(COMMUNITY_BACKFILL_PLATFORMS);
  }

  private async pollPlatforms(platforms: SocialPlatform[]): Promise<void> {
    const accounts = await this.prisma.socialAccount.findMany({
      where: { platform: { in: platforms }, status: 'active', isActive: true, publishMethod: 'api' },
    });
    for (const account of accounts) {
      try {
        await this.pollAccount(account);
      } catch (err) {
        this.logger.warn(`pollAccount: account=${account.id} platform=${account.platform} — ${(err as Error).message}`);
      }
    }
  }

  private async pollAccount(account: SocialAccount): Promise<void> {
    const meta = metaOf(account);
    if (meta.commentsPollDisabledAt) return;

    const adapter = communityAdapterFor(account.platform as SocialPlatform);
    if (!adapter) return;

    const accessToken = await this.tokens.getAccessToken(account);
    const secrets = await this.tokens.getSecrets(account);
    if (!secrets) return;

    const postExternalIds = await this.recentPostExternalIds(account);
    const since = typeof meta.commentsSince === 'string' ? meta.commentsSince : null;

    let result: Awaited<ReturnType<typeof adapter.fetchSince>>;
    try {
      result = await adapter.fetchSince({ account, accessToken, secrets }, { postExternalIds, since });
    } catch (err) {
      if (err instanceof SocialApiError && err.kind === 'PERMISSION') {
        this.logger.warn(`pollAccount: account=${account.id} platform=${account.platform} sin permiso — deshabilitando poll hasta reconectar`);
        await this.updateMeta(account.id, { ...meta, commentsPollDisabledAt: new Date().toISOString() });
        return;
      }
      throw err;
    }

    let newCount = 0;
    for (const raw of result.items) {
      const linked = await this.linkPostTarget(raw);
      const { isNew } = await this.ingest.upsertComment(linked);
      if (isNew && !linked.fromUs) newCount++;
    }

    if (result.cursor !== since) {
      await this.updateMeta(account.id, { ...meta, commentsSince: result.cursor });
    }

    if (newCount > 0) {
      await this.realtime.emit(account.tenantId, 'social:comment', { accountId: account.id, platform: account.platform, count: newCount });
      await this.notifier.notify(account.tenantId, 'SOCIAL_COMMENT_RECEIVED', {
        title: 'Nuevos comentarios',
        message: `${newCount} comentario(s) nuevo(s) en ${account.name} (${account.platform})`,
        actionUrl: '/dashboard/social-media/community',
        entityId: account.id,
      });
    }
  }

  private async recentPostExternalIds(account: SocialAccount): Promise<string[]> {
    const targets = await this.prisma.socialPostTarget.findMany({
      where: { accountId: account.id, status: 'published', externalId: { not: null } },
      orderBy: { publishedAt: 'desc' },
      take: MAX_POSTS_TRACKED,
      select: { externalId: true },
    });
    return targets.map((t) => t.externalId).filter((id): id is string => !!id);
  }

  /** Resolves `externalPostId` → our own `SocialPostTarget.id`, per CONTRACT.md §3.6 ("Link comments to our SocialPostTarget via externalPostId when it matches externalId"). */
  private async linkPostTarget(item: NormalizedComment): Promise<NormalizedComment> {
    if (!item.externalPostId) return item;
    const target = await this.prisma.socialPostTarget.findFirst({
      where: { accountId: item.accountId, externalId: item.externalPostId },
      select: { id: true },
    });
    return target ? { ...item, postTargetId: target.id } : item;
  }

  private async updateMeta(accountId: string, meta: Record<string, unknown>): Promise<void> {
    await this.prisma.socialAccount.update({
      where: { id: accountId },
      data: { metaValue: meta as Prisma.InputJsonValue },
    });
  }
}
