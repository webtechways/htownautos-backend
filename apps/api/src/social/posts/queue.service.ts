import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import { SocialAccessService } from '../settings/social-access.service';
import { SocialSchedulingService } from './scheduling.service';
import { emptySlotsInRange } from './slots';

export interface QueueSlotView {
  accountId: string;
  at: string;
}

const MAX_RANGE_DAYS = 60;

@Injectable()
export class SocialQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SocialAccessService,
    private readonly scheduling: SocialSchedulingService,
  ) {}

  /** `GET /social/queue/slots` — empty ("+ New") slots per channel in `[from, to]`, for the composer list view. */
  async emptySlots(tenantId: string, accountIdsCsv: string | undefined, fromIso: string, toIso: string): Promise<QueueSlotView[]> {
    const from = new Date(fromIso);
    const to = new Date(toIso);
    const rangeDays = (to.getTime() - from.getTime()) / 86400000;
    if (!(from.getTime() < to.getTime()) || rangeDays > MAX_RANGE_DAYS) {
      throw new BadRequestException(`El rango debe ser válido y de máximo ${MAX_RANGE_DAYS} días`);
    }

    const accountIds = accountIdsCsv ? accountIdsCsv.split(',').filter(Boolean) : undefined;
    const accounts = await this.prisma.socialAccount.findMany({
      where: { tenantId, isActive: true, publishMethod: { in: ['api', 'reminder'] }, ...(accountIds ? { id: { in: accountIds } } : {}) },
      select: { id: true },
    });
    if (accounts.length === 0) return [];

    const settings = await this.access.getSettings(tenantId);

    const results: QueueSlotView[] = [];
    for (const account of accounts) {
      const config = await this.scheduling.getScheduleConfig(this.prisma, account.id, settings.defaultTimezone);
      const occupied = await this.scheduling.occupiedTimes(this.prisma, tenantId, account.id);
      for (const at of emptySlotsInRange(config, from, to, occupied)) {
        results.push({ accountId: account.id, at: at.toISOString() });
      }
    }

    return results.sort((a, b) => a.at.localeCompare(b.at));
  }

  /** `POST /social/queue/:accountId/shuffle` — permutes the channel's currently-slotted targets' times. */
  async shuffle(tenantId: string, accountId: string): Promise<{ moved: number }> {
    const account = await this.prisma.socialAccount.findFirst({ where: { id: accountId, tenantId }, select: { id: true } });
    if (!account) throw new NotFoundException('Cuenta no encontrada');

    const settings = await this.access.getSettings(tenantId);
    const moved = await this.scheduling.shuffleSlots(tenantId, accountId, settings.defaultTimezone, new Date());
    return { moved };
  }
}
