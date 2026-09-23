import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import { S3Service } from '@htownautos/common';
import type { SocialMedia, SocialPostTarget } from '@prisma/client';
import {
  SocialTokenService,
  SocialNotifierService,
  SocialRealtimeService,
  MediaResolverService,
  PLATFORM_PUBLISHERS,
  SocialApiError,
  applyLinkShortening,
  type PublishContext,
  type PublishResult,
  type PublishThreadItem,
  type PlatformOptions,
  type PublishablePlatform,
} from '@htownautos/social';
import { computeRetry } from './backoff';
import { recomputePostStatus, type TargetStatus } from './post-status';

const TEMP_MEDIA_PREFIX = 'social/tmp';

/** Everything about one target the runner needs beyond the row itself. */
interface LoadedTarget {
  target: SocialPostTarget;
  postId: string;
  tenantId: string;
}

@Injectable()
export class PublishRunnerService {
  private readonly logger = new Logger(PublishRunnerService.name);
  private readonly mediaResolver: MediaResolverService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: SocialTokenService,
    private readonly notifier: SocialNotifierService,
    private readonly realtime: SocialRealtimeService,
    private readonly s3: S3Service,
  ) {
    this.mediaResolver = new MediaResolverService(this.s3);
  }

  /** Publishes every target in `targetIds` (already claimed into `publishing`) and settles their post-level state. */
  async runBatch(targetIds: string[]): Promise<void> {
    if (targetIds.length === 0) return;
    const affectedPostIds = new Set<string>();

    for (const targetId of targetIds) {
      try {
        const postId = await this.runOne(targetId);
        if (postId) affectedPostIds.add(postId);
      } catch (err) {
        this.logger.error(`runOne(${targetId}): ${(err as Error).message}`);
      }
    }

    for (const postId of affectedPostIds) {
      await this.settlePost(postId);
    }
  }

  private async runOne(targetId: string): Promise<string | null> {
    const loaded = await this.load(targetId);
    if (!loaded) return null;
    const { target, tenantId, postId } = loaded;

    const account = await this.prisma.socialAccount.findUnique({ where: { id: target.accountId } });
    if (!account) {
      await this.markFailed(target, 'La cuenta ya no existe', true);
      return postId;
    }
    if (account.status === 'disconnected' || !account.isActive) {
      // Contract: a paused/disconnected channel keeps its target `scheduled` — undo the claim rather than fail it.
      await this.prisma.socialPostTarget.update({ where: { id: target.id }, data: { status: 'scheduled', lockedAt: null } });
      return null;
    }

    try {
      const ctx = await this.buildContext(target, account.tenantId, account.platform as PublishablePlatform);
      const publisher = PLATFORM_PUBLISHERS[ctx.platform];
      const result = await publisher.publish(ctx);

      await this.prisma.socialPostTarget.update({
        where: { id: target.id },
        data: {
          status: 'published',
          publishedAt: new Date(),
          externalId: result.externalId,
          externalUrl: result.externalUrl,
          error: null,
          lockedAt: null,
          nextAttemptAt: null,
        },
      });

      await this.publishThreadAndComment(ctx, target, publisher, result);
      await this.realtime.emit(tenantId, 'social:post', { postId, targetId: target.id, status: 'published' });
      return postId;
    } catch (err) {
      await this.handleFailure(target, tenantId, postId, err);
      return postId;
    }
  }

  /** Thread items and the first comment are best-effort once the main post is published — a failure here is a warning, not a publish failure. */
  private async publishThreadAndComment(
    ctx: PublishContext,
    target: SocialPostTarget,
    publisher: (typeof PLATFORM_PUBLISHERS)[PublishablePlatform],
    mainResult: PublishResult,
  ): Promise<void> {
    const warnings: string[] = [];
    const thread = (target.thread as unknown as PublishThreadItem[]) ?? [];

    if (thread.length > 0 && publisher.publishThreadItem) {
      let parent = mainResult;
      for (let i = 0; i < thread.length; i++) {
        try {
          parent = await publisher.publishThreadItem(ctx, { root: mainResult, parent }, thread[i], i);
        } catch (err) {
          warnings.push(`Hilo #${i + 1}: ${(err as Error).message}`);
          break; // can't chain replies past a broken link
        }
      }
    }

    if (target.firstComment && publisher.postFirstComment) {
      try {
        await publisher.postFirstComment(ctx, mainResult.externalId, target.firstComment);
      } catch (err) {
        warnings.push(`Primer comentario: ${(err as Error).message}`);
      }
    }

    if (warnings.length > 0) {
      await this.prisma.socialPostTarget.update({ where: { id: target.id }, data: { error: warnings.join(' | ').slice(0, 1000) } });
    }
  }

  private async handleFailure(target: SocialPostTarget, tenantId: string, postId: string, err: unknown): Promise<void> {
    const isTransient = err instanceof SocialApiError ? err.isTransient() : true;
    const message = (err as Error).message?.slice(0, 1000) || 'Error desconocido';

    if (!isTransient) {
      await this.markFailed(target, message, false);
      await this.realtime.emit(tenantId, 'social:post', { postId, targetId: target.id, status: 'failed' });
      return;
    }

    const retry = computeRetry(target.attempts);
    if (retry.terminal) {
      await this.markFailed(target, message, false, retry.attempts);
      await this.realtime.emit(tenantId, 'social:post', { postId, targetId: target.id, status: 'failed' });
      return;
    }

    await this.prisma.socialPostTarget.update({
      where: { id: target.id },
      data: { status: 'scheduled', attempts: retry.attempts, nextAttemptAt: retry.nextAttemptAt, error: message, lockedAt: null },
    });
    await this.realtime.emit(tenantId, 'social:post', { postId, targetId: target.id, status: 'scheduled', retrying: true });
  }

  private async markFailed(target: SocialPostTarget, message: string, keepAttempts: boolean, attempts?: number): Promise<void> {
    await this.prisma.socialPostTarget.update({
      where: { id: target.id },
      data: {
        status: 'failed',
        error: message.slice(0, 1000),
        lockedAt: null,
        nextAttemptAt: null,
        ...(keepAttempts ? {} : { attempts: attempts ?? target.attempts }),
      },
    });
  }

  /** Recomputes `SocialPost.status` and sends one `SOCIAL_POST_FAILED` notification if this settle newly reveals a failed/partial post. */
  private async settlePost(postId: string): Promise<void> {
    const post = await this.prisma.socialPost.findUnique({
      where: { id: postId },
      include: { targets: { include: { account: true } } },
    });
    if (!post) return;

    const newStatus = recomputePostStatus(post.targets.map((t) => t.status as TargetStatus));
    const wasAlreadyDone = post.status === 'failed' || post.status === 'partial' || post.status === 'published';
    if (newStatus !== post.status) {
      await this.prisma.socialPost.update({ where: { id: postId }, data: { status: newStatus } });
      await this.realtime.emit(post.tenantId, 'social:post', { postId, status: newStatus });
    }

    if ((newStatus === 'failed' || newStatus === 'partial') && !wasAlreadyDone) {
      const failedChannels = post.targets.filter((t) => t.status === 'failed').map((t) => `${t.account.name} (${t.account.platform})`);
      if (failedChannels.length > 0) {
        await this.notifier.notify(post.tenantId, 'SOCIAL_POST_FAILED', {
          title: 'Publicación falló en algunos canales',
          message: `"${post.content.slice(0, 80)}" falló en: ${failedChannels.join(', ')}`,
          actionUrl: `/dashboard/social-media/publish/${postId}`,
          entityId: postId,
        });
      }
    }
  }

  // ─── context building ──────────────────────────────────────────────────

  private async load(targetId: string): Promise<LoadedTarget | null> {
    const target = await this.prisma.socialPostTarget.findUnique({ where: { id: targetId } });
    if (!target) return null;
    return { target, postId: target.postId, tenantId: target.tenantId };
  }

  private async buildContext(target: SocialPostTarget, tenantId: string, platform: PublishablePlatform): Promise<PublishContext> {
    const account = await this.prisma.socialAccount.findUniqueOrThrow({ where: { id: target.accountId } });
    const post = await this.prisma.socialPost.findUniqueOrThrow({ where: { id: target.postId } });

    const rawContent = target.content ?? post.content;
    const mediaIds = (target.mediaOverride as unknown as string[] | null) ?? post.mediaIds;
    const thread = (target.thread as unknown as PublishThreadItem[]) ?? [];

    const allMediaIds = Array.from(new Set([...mediaIds, ...thread.flatMap((t) => t.mediaIds)]));
    const mediaRows = allMediaIds.length > 0 ? await this.prisma.socialMedia.findMany({ where: { id: { in: allMediaIds }, tenantId } }) : [];
    const mediaById = new Map<string, SocialMedia>(mediaRows.map((m) => [m.id, m]));

    const settings = await this.prisma.socialSettings.findUnique({ where: { tenantId } });
    const content = await applyLinkShortening(this.prisma, tenantId, target.id, platform, rawContent, {
      shortenLinks: settings?.shortenLinks ?? false,
      utmEnabled: settings?.utmEnabled ?? false,
      utmSource: settings?.utmSource ?? null,
      utmMedium: settings?.utmMedium ?? 'social',
      utmCampaign: settings?.utmCampaign ?? null,
    });

    const accessToken = await this.tokenService.getAccessToken(account);
    const secrets = (await this.tokenService.getSecrets(account)) ?? { accessToken };

    return {
      tenantId,
      platform,
      account,
      target,
      accessToken,
      secrets,
      content,
      mediaIds,
      mediaById,
      options: (target.options as unknown as PlatformOptions) ?? {},
      resolver: this.mediaResolver,
      reuploadTemp: async (buffer, ext, contentType) => {
        const key = `${TEMP_MEDIA_PREFIX}/${tenantId}/${target.id}-${Date.now()}.${ext}`;
        await this.s3.uploadBufferToKey(buffer, key, contentType);
        return this.s3.getSignedUrl(key, 3600);
      },
    };
  }
}
