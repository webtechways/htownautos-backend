import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import type { ScheduleSlot } from '@htownautos/social';
import { DEFAULT_SCHEDULE_SLOTS, nextFreeSlot, nextSlot, occurrencesFrom, type ScheduleConfig } from './slots';

/** Every scheduling read/write in this file must run against the SAME client (plain or a `$transaction` tx) so a multi-target create sees its own uncommitted shifts. */
export type Db = PrismaService | Prisma.TransactionClient;

const ACTIVE_TARGET_STATUSES = ['draft', 'pending_approval', 'scheduled', 'publishing'] as const;

/**
 * Per-channel slot assignment (CONTRACT.md §3.3): `queue` (next free slot),
 * `next` (insert + cascade-shift), and the raw config/occupancy reads behind
 * `GET /social/queue/slots`. Wraps the pure math in `./slots.ts` with the DB
 * reads it needs (the channel's own `SocialPostingSchedule`, and which
 * instants are already taken).
 */
@Injectable()
export class SocialSchedulingService {
  constructor(private readonly prisma: PrismaService) {}

  async getScheduleConfig(db: Db, accountId: string, defaultTimezone: string): Promise<ScheduleConfig> {
    const row = await db.socialPostingSchedule.findUnique({ where: { accountId } });
    if (!row) return { timezone: defaultTimezone, slots: DEFAULT_SCHEDULE_SLOTS };
    return { timezone: row.timezone, slots: row.slots as unknown as ScheduleSlot[] };
  }

  /** Instants already claimed by a "queue"-slotted target of this channel (any not-yet-terminal status). */
  async occupiedTimes(db: Db, tenantId: string, accountId: string): Promise<Set<number>> {
    const rows = await db.socialPostTarget.findMany({
      where: { tenantId, accountId, slotted: true, scheduledAt: { not: null }, status: { in: [...ACTIVE_TARGET_STATUSES] } },
      select: { scheduledAt: true },
    });
    return new Set(rows.map((r) => r.scheduledAt!.getTime()));
  }

  /** `mode=queue`: next free slot after `now` for this channel. */
  async assignQueueSlot(db: Db, tenantId: string, accountId: string, defaultTimezone: string, now: Date): Promise<Date> {
    const [config, occupied] = await Promise.all([
      this.getScheduleConfig(db, accountId, defaultTimezone),
      this.occupiedTimes(db, tenantId, accountId),
    ]);
    return nextFreeSlot(config, now, occupied);
  }

  /**
   * `mode=next`: the new target's slot + the existing queue-slotted targets
   * (of the SAME channel, at or after that slot) that must move one slot
   * later each, in order. Caller applies `shifts` with its own `update`s in
   * the same transaction as the new target's insert.
   */
  async planNextSlot(
    db: Db,
    tenantId: string,
    accountId: string,
    defaultTimezone: string,
    now: Date,
  ): Promise<{ newSlot: Date; shifts: { id: string; scheduledAt: Date }[] }> {
    const config = await this.getScheduleConfig(db, accountId, defaultTimezone);
    const newSlot = nextSlot(config, now);

    const existing = await db.socialPostTarget.findMany({
      where: { tenantId, accountId, slotted: true, scheduledAt: { gte: newSlot }, status: { in: [...ACTIVE_TARGET_STATUSES] } },
      orderBy: { scheduledAt: 'asc' },
      select: { id: true },
    });
    if (existing.length === 0) return { newSlot, shifts: [] };

    const chain = occurrencesFrom(config, now, existing.length + 1);
    return { newSlot, shifts: existing.map((row, i) => ({ id: row.id, scheduledAt: chain[i + 1] })) };
  }

  /** `POST /social/queue/:accountId/shuffle` — permutes the channel's currently-slotted targets' times among themselves. */
  async shuffleSlots(tenantId: string, accountId: string, defaultTimezone: string, now: Date): Promise<number> {
    const targets = await this.prisma.socialPostTarget.findMany({
      where: { tenantId, accountId, slotted: true, scheduledAt: { gte: now }, status: { in: [...ACTIVE_TARGET_STATUSES] } },
      orderBy: { scheduledAt: 'asc' },
      select: { id: true, scheduledAt: true },
    });
    if (targets.length < 2) return 0;

    const times = targets.map((t) => t.scheduledAt!.getTime());
    const shuffled = shuffleArray(times);

    await this.prisma.$transaction(targets.map((t, i) => this.prisma.socialPostTarget.update({ where: { id: t.id }, data: { scheduledAt: new Date(shuffled[i]) } })));
    return targets.length;
  }
}

function shuffleArray<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
