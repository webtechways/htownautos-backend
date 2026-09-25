import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@htownautos/prisma';
import { RabbitMQService, CLERK_PUSH_QUEUE } from '@htownautos/rabbitmq';
import { MAX_CLERK_SYNC_ATTEMPTS } from './identity-clerk-push.consumer';

/**
 * PENDING older than this is assumed lost — `RabbitMQService.publish` drops
 * the message silently when RabbitMQ is disconnected, so a push can vanish
 * with no error anywhere. This is the only thing that notices.
 */
const PENDING_STALE_MIN = 2;

/**
 * Sweep for `identity.clerk.push` (CLERK-SYNC-DESIGN.md, package B2).
 * Re-publishes:
 *  - PENDING rows stuck > 2 min (message likely dropped, or the row was
 *    marked PENDING by a transient-error retry in the consumer).
 *  - FAILED rows, with backoff, up to MAX_CLERK_SYNC_ATTEMPTS — past that a
 *    row needs a human (see the "Send portal access" / retry button, F1).
 *
 * Re-publishing is always safe: the consumer rereads the User fresh and
 * hashes the desired state, so an unnecessary re-publish is just a no-op.
 */
@Injectable()
export class IdentitySyncSweepService {
  private readonly logger = new Logger(IdentitySyncSweepService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitMQ: RabbitMQService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async tick(): Promise<void> {
    if (process.env.CLERK_SYNC_ENABLED !== 'true') return;
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep();
    } catch (err) {
      this.logger.error(`sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async sweep(): Promise<void> {
    const staleCutoff = new Date(Date.now() - PENDING_STALE_MIN * 60 * 1000);

    const [stalePending, failedWithBudget] = await Promise.all([
      this.prisma.user.findMany({
        where: { clerkSyncStatus: 'PENDING', updatedAt: { lt: staleCutoff } },
        select: { id: true },
      }),
      this.prisma.user.findMany({
        where: { clerkSyncStatus: 'FAILED', clerkSyncAttempts: { lt: MAX_CLERK_SYNC_ATTEMPTS } },
        select: { id: true, clerkSyncAttempts: true, clerkEventAt: true, updatedAt: true },
      }),
    ]);

    // Exponential-ish backoff: attempt N waits ~2^N minutes (capped) before
    // the sweep retries it again, so a run of 8 attempts doesn't happen in
    // the first 40 minutes.
    const dueFailed = failedWithBudget.filter((u) => {
      const backoffMin = Math.min(2 ** u.clerkSyncAttempts, 240);
      const dueAt = new Date(u.updatedAt.getTime() + backoffMin * 60 * 1000);
      return dueAt <= new Date();
    });

    const userIds = [...stalePending.map((u) => u.id), ...dueFailed.map((u) => u.id)];
    if (userIds.length === 0) return;

    let published = 0;
    for (const userId of userIds) {
      const ok = await this.rabbitMQ.publish(CLERK_PUSH_QUEUE, { userId });
      if (ok) published++;
    }

    this.logger.log(
      `identity sync sweep: ${stalePending.length} stale PENDING + ${dueFailed.length} due FAILED — ${published}/${userIds.length} republished`,
    );
  }
}
