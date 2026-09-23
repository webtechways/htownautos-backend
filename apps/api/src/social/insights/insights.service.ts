import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, SocialAccount, SocialPostTarget, SocialPost } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import type { AuthenticatedUser } from '@htownautos/auth';
import { MediaResolverService, SocialTokenService, metricsAdapterFor, type SocialPlatform } from '@htownautos/social';
import { SocialAccessService } from '../settings/social-access.service';
import { resolveMediaMap, toAccountSummary, toMediaIdsOverride } from '../posts/mappers';
import { InsightsExportQueryDto, InsightsQueryDto, PostInsightsQueryDto, SyncInsightsDto } from './dto';
import { computeBestTimes, type BestTimePost } from './best-times.util';
import { buildOverview } from './overview.util';
import { metricsOf, targetEngagements } from './metrics-view.util';
import type { BestTimesView, InsightsOverviewView, PostInsightRowView } from './insights.types';

const DEFAULT_PAGE_LIMIT = 20;
const MAX_LIMIT = 100;
/** How far back "best times" looks for published posts to score (CONTRACT.md §3.8). */
const BEST_TIMES_WINDOW_DAYS = 180;
const DEFAULT_TIMEZONE = 'America/Chicago';

const CSV_HEADER = 'platform,account,publishedAt,content,impressions,reach,likes,comments,shares,saves,clicks,engagementRate,url';

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

type TargetWithAccountAndPost = SocialPostTarget & { account: SocialAccount; post: SocialPost };

const TARGET_WITH_ACCOUNT_AND_POST = { include: { account: true, post: true } } satisfies Prisma.SocialPostTargetDefaultArgs;

function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function firstMediaId(target: TargetWithAccountAndPost): string | null {
  const override = toMediaIdsOverride(target.mediaOverride);
  const ids = override && override.length > 0 ? override : target.post.mediaIds;
  return ids && ids.length > 0 ? ids[0] : null;
}

/** Insights (CONTRACT.md §3.8): overview, per-post rows, best-times heatmap, CSV export, admin-triggered sync. */
@Injectable()
export class SocialInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: SocialTokenService,
    private readonly mediaResolver: MediaResolverService,
    private readonly access: SocialAccessService,
  ) {}

  async overview(tenantId: string, query: InsightsQueryDto): Promise<InsightsOverviewView> {
    const accountIds = await this.resolveAccountIds(tenantId, query.accountIds);
    const range = { from: query.from, to: query.to };
    if (accountIds.length === 0) return buildOverview(range, [], [], [], []);

    const fromDate = new Date(`${query.from}T00:00:00Z`);
    const toDate = new Date(`${query.to}T00:00:00Z`);
    const rangeStart = new Date(`${query.from}T00:00:00.000Z`);
    const rangeEnd = new Date(`${query.to}T23:59:59.999Z`);

    const [accounts, dailyRows, targets] = await Promise.all([
      this.prisma.socialAccount.findMany({ where: { id: { in: accountIds }, tenantId } }),
      this.prisma.socialAccountMetricDaily.findMany({
        where: { tenantId, accountId: { in: accountIds }, date: { gte: fromDate, lte: toDate } },
        orderBy: { date: 'asc' },
      }),
      this.prisma.socialPostTarget.findMany({
        where: { tenantId, accountId: { in: accountIds }, status: 'published', publishedAt: { gte: rangeStart, lte: rangeEnd } },
      }),
    ]);

    return buildOverview(range, accountIds, accounts, dailyRows, targets);
  }

  async posts(tenantId: string, query: PostInsightsQueryDto): Promise<Paginated<PostInsightRowView>> {
    const accountIds = await this.resolveAccountIds(tenantId, query.accountIds);
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? DEFAULT_PAGE_LIMIT, MAX_LIMIT);
    if (accountIds.length === 0) return { data: [], total: 0, page, limit, totalPages: 0 };

    const rangeStart = new Date(`${query.from}T00:00:00.000Z`);
    const rangeEnd = new Date(`${query.to}T23:59:59.999Z`);

    const targets = (await this.prisma.socialPostTarget.findMany({
      where: { tenantId, accountId: { in: accountIds }, status: 'published', publishedAt: { gte: rangeStart, lte: rangeEnd } },
      ...TARGET_WITH_ACCOUNT_AND_POST,
    })) as TargetWithAccountAndPost[];

    const scored = targets.map((t) => {
      const m = metricsOf(t);
      return {
        target: t,
        impressions: m?.impressions ?? 0,
        engagements: targetEngagements(t) ?? 0,
        engagementRate: m?.engagementRate ?? 0,
      };
    });

    const sort = query.sort ?? 'date';
    scored.sort((a, b) => {
      switch (sort) {
        case 'impressions':
          return b.impressions - a.impressions;
        case 'engagements':
          return b.engagements - a.engagements;
        case 'engagementRate':
          return b.engagementRate - a.engagementRate;
        case 'date':
        default:
          return (b.target.publishedAt?.getTime() ?? 0) - (a.target.publishedAt?.getTime() ?? 0);
      }
    });

    const total = scored.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const paged = scored.slice((page - 1) * limit, (page - 1) * limit + limit);

    const mediaIds = paged.map((r) => firstMediaId(r.target)).filter((id): id is string => !!id);
    const mediaMap = await resolveMediaMap(this.prisma, this.mediaResolver, tenantId, mediaIds);

    const data: PostInsightRowView[] = paged.map((r) => {
      const t = r.target;
      const firstId = firstMediaId(t);
      return {
        post: { id: t.post.id, content: t.post.content, mediaUrl: firstId ? (mediaMap.get(firstId)?.url ?? null) : null },
        target: {
          id: t.id,
          accountId: t.accountId,
          account: toAccountSummary(t.account),
          publishedAt: t.publishedAt ? t.publishedAt.toISOString() : null,
          externalUrl: t.externalUrl,
          metrics: metricsOf(t),
        },
      };
    });

    return { data, total, page, limit, totalPages };
  }

  async bestTimes(tenantId: string, accountId: string): Promise<BestTimesView> {
    const account = await this.prisma.socialAccount.findFirst({ where: { id: accountId, tenantId } });
    if (!account) throw new NotFoundException('Cuenta no encontrada');

    const [schedule, settings] = await Promise.all([
      this.prisma.socialPostingSchedule.findUnique({ where: { accountId } }),
      this.prisma.socialSettings.findUnique({ where: { tenantId } }),
    ]);
    const timezone = schedule?.timezone ?? settings?.defaultTimezone ?? DEFAULT_TIMEZONE;

    const since = new Date(Date.now() - BEST_TIMES_WINDOW_DAYS * 86_400_000);
    const targets = await this.prisma.socialPostTarget.findMany({
      where: { tenantId, accountId, status: 'published', publishedAt: { gte: since } },
    });

    const posts: BestTimePost[] = targets
      .filter((t): t is SocialPostTarget & { publishedAt: Date } => !!t.publishedAt)
      .map((t) => ({ publishedAt: t.publishedAt, engagement: targetEngagements(t) ?? 0 }));

    const { source, cells } = computeBestTimes(posts, timezone);
    return { accountId, timezone, source, cells };
  }

  async exportCsv(tenantId: string, query: InsightsExportQueryDto): Promise<string> {
    const accountIds = await this.resolveAccountIds(tenantId, query.accountIds);
    if (accountIds.length === 0) return `${CSV_HEADER}\n`;

    const rangeStart = new Date(`${query.from}T00:00:00.000Z`);
    const rangeEnd = new Date(`${query.to}T23:59:59.999Z`);
    const targets = (await this.prisma.socialPostTarget.findMany({
      where: { tenantId, accountId: { in: accountIds }, status: 'published', publishedAt: { gte: rangeStart, lte: rangeEnd } },
      ...TARGET_WITH_ACCOUNT_AND_POST,
      orderBy: { publishedAt: 'desc' },
    })) as TargetWithAccountAndPost[];

    const lines = [CSV_HEADER];
    for (const t of targets) {
      const m = metricsOf(t);
      lines.push(
        [
          t.account.platform,
          csvField(t.account.name),
          t.publishedAt ? t.publishedAt.toISOString() : '',
          csvField(t.post.content),
          m?.impressions ?? '',
          m?.reach ?? '',
          m?.likes ?? '',
          m?.comments ?? '',
          m?.shares ?? '',
          m?.saves ?? '',
          m?.clicks ?? '',
          m?.engagementRate != null ? m.engagementRate.toFixed(4) : '',
          t.externalUrl ? csvField(t.externalUrl) : '',
        ].join(','),
      );
    }
    return lines.join('\n');
  }

  async sync(tenantId: string, user: Pick<AuthenticatedUser, 'id'>, dto: SyncInsightsDto): Promise<{ queued: number }> {
    const isAdmin = await this.access.isAdmin(user, tenantId);
    if (!isAdmin) throw new ForbiddenException('Solo administradores pueden sincronizar métricas');

    const where: Prisma.SocialAccountWhereInput = { tenantId, status: 'active', isActive: true, publishMethod: 'api' };
    if (dto.accountId) {
      const exists = await this.prisma.socialAccount.count({ where: { id: dto.accountId, tenantId } });
      if (!exists) throw new NotFoundException('Cuenta no encontrada');
      where.id = dto.accountId;
    }

    const accounts = await this.prisma.socialAccount.findMany({ where });
    const date = new Date().toISOString().slice(0, 10);
    let queued = 0;
    for (const account of accounts) {
      try {
        await this.snapshotAccount(account, date);
        queued++;
      } catch {
        // best-effort — one account's failure never blocks the others (CONTRACT.md §4).
      }
    }
    return { queued };
  }

  private async snapshotAccount(account: SocialAccount, date: string): Promise<void> {
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

  /** CSV of account ids → tenant-scoped account ids. Every id must belong to `tenantId` (§2: foreign ids → 404 otherwise). No filter = every account in the tenant. */
  private async resolveAccountIds(tenantId: string, csv?: string): Promise<string[]> {
    if (!csv) {
      const accounts = await this.prisma.socialAccount.findMany({ where: { tenantId }, select: { id: true } });
      return accounts.map((a) => a.id);
    }
    const ids = Array.from(new Set(csv.split(',').map((s) => s.trim()).filter(Boolean)));
    if (ids.length === 0) return [];
    const count = await this.prisma.socialAccount.count({ where: { id: { in: ids }, tenantId } });
    if (count !== ids.length) throw new NotFoundException('Una o más cuentas no existen en este tenant');
    return ids;
  }
}
