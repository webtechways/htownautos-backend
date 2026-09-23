import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import { SocialGoalInputDto } from './dto';

const DEFAULT_POSTS_PER_WEEK = 3;

export interface SocialGoalView {
  accountId: string;
  postsPerWeek: number;
}

@Injectable()
export class SocialGoalsService {
  constructor(private readonly prisma: PrismaService) {}

  /** One row per publishable channel, defaulting to 3 posts/week for channels without a saved goal. */
  async list(tenantId: string): Promise<SocialGoalView[]> {
    const accounts = await this.prisma.socialAccount.findMany({ where: { tenantId, publishMethod: { in: ['api', 'reminder'] } }, select: { id: true } });
    if (accounts.length === 0) return [];

    const rows = await this.prisma.socialGoal.findMany({ where: { tenantId, accountId: { in: accounts.map((a) => a.id) } } });
    const byAccount = new Map(rows.map((r) => [r.accountId, r.postsPerWeek]));

    return accounts.map((a) => ({ accountId: a.id, postsPerWeek: byAccount.get(a.id) ?? DEFAULT_POSTS_PER_WEEK }));
  }

  async update(tenantId: string, goals: SocialGoalInputDto[]): Promise<SocialGoalView[]> {
    if (goals.length === 0) return this.list(tenantId);

    const accountIds = goals.map((g) => g.accountId);
    const accounts = await this.prisma.socialAccount.findMany({ where: { tenantId, id: { in: accountIds } }, select: { id: true } });
    const validIds = new Set(accounts.map((a) => a.id));
    for (const g of goals) {
      if (!validIds.has(g.accountId)) throw new NotFoundException(`Cuenta ${g.accountId} no encontrada`);
    }

    await this.prisma.$transaction(
      goals.map((g) =>
        this.prisma.socialGoal.upsert({
          where: { accountId: g.accountId },
          create: { tenantId, accountId: g.accountId, postsPerWeek: g.postsPerWeek },
          update: { postsPerWeek: g.postsPerWeek },
        }),
      ),
    );

    return this.list(tenantId);
  }
}
