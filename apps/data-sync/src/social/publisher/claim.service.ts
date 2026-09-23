import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';

const CLAIM_BATCH_SIZE = 25;
const STALE_PUBLISHING_MIN = 30;

/**
 * Atomic claiming for the publisher worker, per CONTRACT.md §4:
 * `FOR UPDATE SKIP LOCKED` so a second data-sync replica (or an overlapping
 * tick) never grabs the same target twice. Raw SQL because Prisma's query
 * builder has no `FOR UPDATE`/`SKIP LOCKED` — there's no other raw-SQL
 * locking precedent in this codebase yet, documented here for the next
 * person who needs the same pattern.
 */
@Injectable()
export class SocialPublishClaimService {
  private readonly logger = new Logger(SocialPublishClaimService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Targets whose account publishes through the API and whose slot has come due. Claims them into `publishing`. */
  async claimDuePublishTargets(): Promise<string[]> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT t.id
        FROM social_post_targets t
        JOIN social_accounts a ON a.id = t."accountId"
        LEFT JOIN social_posting_schedules sch ON sch."accountId" = a.id
        WHERE t.status = 'scheduled'
          AND t."scheduledAt" <= now()
          AND (t."nextAttemptAt" IS NULL OR t."nextAttemptAt" <= now())
          AND a."publishMethod" = 'api'
          AND a."isActive" = true
          AND a.status <> 'disconnected'
          AND COALESCE(sch.paused, false) = false
        ORDER BY t."scheduledAt" ASC
        LIMIT ${CLAIM_BATCH_SIZE}
        FOR UPDATE OF t SKIP LOCKED
      `;
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      await tx.socialPostTarget.updateMany({ where: { id: { in: ids } }, data: { status: 'publishing', lockedAt: new Date() } });
      return ids;
    });
  }

  /** Reminder-channel targets whose time has come. Claims them straight into `reminder_due` (terminal from the worker's point of view). */
  async claimDueReminderTargets(): Promise<string[]> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT t.id
        FROM social_post_targets t
        JOIN social_accounts a ON a.id = t."accountId"
        LEFT JOIN social_posting_schedules sch ON sch."accountId" = a.id
        WHERE t.status = 'scheduled'
          AND t."scheduledAt" <= now()
          AND a."publishMethod" = 'reminder'
          AND a."isActive" = true
          AND COALESCE(sch.paused, false) = false
        ORDER BY t."scheduledAt" ASC
        LIMIT ${CLAIM_BATCH_SIZE}
        FOR UPDATE OF t SKIP LOCKED
      `;
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      await tx.socialPostTarget.updateMany({ where: { id: { in: ids } }, data: { status: 'reminder_due' } });
      return ids;
    });
  }

  /**
   * Atomically claims one specific target for the "publish now" queue path
   * — only succeeds if it's still `scheduled` (the 30s cron tick may have
   * already grabbed it first; that's fine, this one just backs off).
   */
  async claimTargetById(targetId: string): Promise<boolean> {
    const result = await this.prisma.socialPostTarget.updateMany({
      where: { id: targetId, status: 'scheduled' },
      data: { status: 'publishing', lockedAt: new Date() },
    });
    return result.count > 0;
  }

  /** Targets stuck `publishing` past a crash/redeploy — hand them back to the queue. */
  async recoverStale(): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_PUBLISHING_MIN * 60_000);
    const result = await this.prisma.socialPostTarget.updateMany({
      where: { status: 'publishing', lockedAt: { lt: cutoff } },
      data: { status: 'scheduled', lockedAt: null },
    });
    if (result.count > 0) this.logger.warn(`recoverStale: ${result.count} target(s) devuelto(s) a scheduled (lockedAt > ${STALE_PUBLISHING_MIN}min)`);
    return result.count;
  }
}
