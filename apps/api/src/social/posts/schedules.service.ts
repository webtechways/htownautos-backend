import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import type { ScheduleSlot } from '@htownautos/social';
import { SocialAccessService } from '../settings/social-access.service';
import { DEFAULT_SCHEDULE_SLOTS } from './slots';
import { UpdatePostingScheduleDto } from './dto';

export interface PostingScheduleView {
  accountId: string;
  timezone: string;
  paused: boolean;
  slots: ScheduleSlot[];
}

@Injectable()
export class SocialSchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SocialAccessService,
  ) {}

  /** One row per publishable channel (`publishMethod` != "none"), defaults filled in for channels without a saved schedule. */
  async list(tenantId: string): Promise<PostingScheduleView[]> {
    const [accounts, settings] = await Promise.all([
      this.prisma.socialAccount.findMany({ where: { tenantId, publishMethod: { in: ['api', 'reminder'] } }, select: { id: true } }),
      this.access.getSettings(tenantId),
    ]);
    if (accounts.length === 0) return [];

    const rows = await this.prisma.socialPostingSchedule.findMany({ where: { tenantId, accountId: { in: accounts.map((a) => a.id) } } });
    const byAccount = new Map(rows.map((r) => [r.accountId, r]));

    return accounts.map((a) => {
      const row = byAccount.get(a.id);
      return row
        ? { accountId: a.id, timezone: row.timezone, paused: row.paused, slots: row.slots as unknown as ScheduleSlot[] }
        : { accountId: a.id, timezone: settings.defaultTimezone, paused: false, slots: DEFAULT_SCHEDULE_SLOTS };
    });
  }

  async update(tenantId: string, accountId: string, dto: UpdatePostingScheduleDto): Promise<PostingScheduleView> {
    const account = await this.prisma.socialAccount.findFirst({ where: { id: accountId, tenantId }, select: { id: true } });
    if (!account) throw new NotFoundException('Cuenta no encontrada');

    const row = await this.prisma.socialPostingSchedule.upsert({
      where: { accountId },
      create: { tenantId, accountId, timezone: dto.timezone, paused: dto.paused, slots: dto.slots as unknown as object },
      update: { timezone: dto.timezone, paused: dto.paused, slots: dto.slots as unknown as object },
    });

    return { accountId: row.accountId, timezone: row.timezone, paused: row.paused, slots: row.slots as unknown as ScheduleSlot[] };
  }
}
