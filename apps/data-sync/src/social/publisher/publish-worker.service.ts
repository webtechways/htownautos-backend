import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@htownautos/prisma';
import { RabbitMQService } from '@htownautos/rabbitmq';
import { SocialNotifierService, SocialRealtimeService, SOCIAL_PUBLISH_QUEUE, type SocialPublishMessage } from '@htownautos/social';
import { SocialPublishClaimService } from './claim.service';
import { PublishRunnerService } from './publish-runner.service';

/**
 * Publisher + reminders loop (CONTRACT.md §4): every 30s claims due
 * `scheduled` targets (`FOR UPDATE SKIP LOCKED`, paused/disconnected
 * accounts skipped) and reminder-channel targets, plus consumes
 * `SOCIAL_PUBLISH_QUEUE` for "publish now" requests from the api.
 */
@Injectable()
export class PublishWorkerService implements OnModuleInit {
  private readonly logger = new Logger(PublishWorkerService.name);
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitMQ: RabbitMQService,
    private readonly claim: SocialPublishClaimService,
    private readonly runner: PublishRunnerService,
    private readonly notifier: SocialNotifierService,
    private readonly realtime: SocialRealtimeService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.rabbitMQ.consume(SOCIAL_PUBLISH_QUEUE, async (raw) => {
      await this.handlePublishNow(raw as unknown as SocialPublishMessage);
    });
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.claim.recoverStale();

      const dueTargetIds = await this.claim.claimDuePublishTargets();
      if (dueTargetIds.length > 0) await this.runner.runBatch(dueTargetIds);

      const reminderIds = await this.claim.claimDueReminderTargets();
      for (const id of reminderIds) await this.notifyReminderDue(id);
    } catch (err) {
      this.logger.error(`tick: ${(err as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  /** "Publish now" from the api's `POST /social/posts/:id/publish-now` (or reschedule-to-now) — claims each id defensively in case the 30s tick got there first. */
  private async handlePublishNow(msg: SocialPublishMessage): Promise<void> {
    if (!msg?.targetIds?.length) return;
    const claimed: string[] = [];
    for (const id of msg.targetIds) {
      if (await this.claim.claimTargetById(id)) claimed.push(id);
    }
    if (claimed.length > 0) await this.runner.runBatch(claimed);
  }

  private async notifyReminderDue(targetId: string): Promise<void> {
    const target = await this.prisma.socialPostTarget.findUnique({
      where: { id: targetId },
      include: { account: true, post: true },
    });
    if (!target) return;

    await this.realtime.emit(target.tenantId, 'social:post', { postId: target.postId, targetId: target.id, status: 'reminder_due' });
    await this.notifier.notify(target.tenantId, 'SOCIAL_REMINDER_DUE', {
      title: 'Recordatorio de publicación',
      message: `Toca publicar a mano en ${target.account.name} (${target.account.platform}): "${target.post.content.slice(0, 80)}"`,
      actionUrl: `/dashboard/social-media/publish/reminder/${target.id}?post=${target.postId}`,
      entityId: target.id,
    });
  }
}
