import { Injectable } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import { MediaResolverService } from '@htownautos/social';
import { SocialAccessService } from '../settings/social-access.service';
import { toAccountSummary, resolveMediaMap, type AccountSummaryView } from './mappers';
import { collectMediaIds, POST_INCLUDE, toPostView, type SocialPostView } from './post-view';
import { startOfWeekUtc } from './slots';

const UP_NEXT_LIMIT = 5;
const RECENT_COMMENTS_LIMIT = 5;
const COMMENT_SCORE_WINDOW_DAYS = 30;
const STREAK_LOOKBACK_WEEKS = 104; // ~2 years, generous cap so the loop can't run forever

/** Minimal contract.ts `SocialComment` view — Home only needs a preview, not the full community module (B4, different package). */
export interface RecentCommentView {
  id: string;
  accountId: string;
  account: AccountSummaryView;
  platform: string;
  kind: string;
  status: string;
  authorName: string;
  authorHandle: string | null;
  authorAvatarUrl: string | null;
  body: string;
  permalink: string | null;
  rating: number | null;
  fromUs: boolean;
  createdAt: string;
}

export interface SocialHomeView {
  weekStreak: number;
  goals: { accountId: string; account: AccountSummaryView; target: number; done: number }[];
  commentScore: number;
  counts: {
    queue: number;
    drafts: number;
    approvals: number;
    sentLast7d: number;
    failed: number;
    openComments: number;
    unreadMessages: number;
  };
  upNext: SocialPostView[];
  recentComments: RecentCommentView[];
  firstSteps: { channelConnected: boolean; postCreated: boolean; apiKeyCreated: boolean };
}

@Injectable()
export class SocialHomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: MediaResolverService,
    private readonly access: SocialAccessService,
  ) {}

  async get(tenantId: string): Promise<SocialHomeView> {
    const settings = await this.access.getSettings(tenantId);
    const tz = settings.defaultTimezone;
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
    const thirtyDaysAgo = new Date(now.getTime() - COMMENT_SCORE_WINDOW_DAYS * 86400000);
    const weekStart = startOfWeekUtc(now, tz);
    const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);

    const [
      queueCount,
      draftsCount,
      approvalsCount,
      sentLast7d,
      failedCount,
      openComments,
      unreadMessages,
      goalAccounts,
      publishedThisWeek,
      publishedForStreak,
      commentWindow,
      upNextRows,
      recentCommentRows,
      channelConnected,
      postCreated,
      apiKeyCreated,
    ] = await Promise.all([
      this.prisma.socialPost.count({ where: { tenantId, status: { in: ['scheduled', 'publishing', 'failed'] } } }),
      this.prisma.socialPost.count({ where: { tenantId, status: 'draft' } }),
      this.prisma.socialPost.count({ where: { tenantId, status: 'pending_approval' } }),
      this.prisma.socialPost.count({ where: { tenantId, status: { in: ['published', 'partial'] }, updatedAt: { gte: sevenDaysAgo } } }),
      this.prisma.socialPost.count({ where: { tenantId, status: 'failed' } }),
      this.prisma.socialComment.count({ where: { tenantId, status: 'open' } }),
      this.prisma.inboxConversation.aggregate({ where: { tenantId }, _sum: { unreadCount: true } }),
      this.prisma.socialAccount.findMany({ where: { tenantId, publishMethod: { in: ['api', 'reminder'] } } }),
      this.prisma.socialPostTarget.groupBy({
        by: ['accountId'],
        where: { tenantId, status: 'published', publishedAt: { gte: weekStart, lt: weekEnd } },
        _count: { _all: true },
      }),
      this.prisma.socialPostTarget.findMany({
        where: { tenantId, status: 'published', publishedAt: { not: null, gte: new Date(now.getTime() - STREAK_LOOKBACK_WEEKS * 7 * 86400000) } },
        select: { publishedAt: true },
      }),
      this.prisma.socialComment.findMany({ where: { tenantId, fromUs: false, platformCreatedAt: { gte: thirtyDaysAgo } }, select: { status: true, repliedAt: true } }),
      this.prisma.socialPost.findMany({
        where: { tenantId, status: { in: ['scheduled', 'publishing'] } },
        include: POST_INCLUDE,
        orderBy: { updatedAt: 'desc' }, // proxy for "soonest" — SocialPost has no stored scheduledAt column (derived from targets)
        take: UP_NEXT_LIMIT,
      }),
      this.prisma.socialComment.findMany({ where: { tenantId }, include: { account: true }, orderBy: { platformCreatedAt: 'desc' }, take: RECENT_COMMENTS_LIMIT }),
      this.prisma.socialAccount.count({ where: { tenantId, isActive: true } }),
      this.prisma.socialPost.count({ where: { tenantId } }),
      this.prisma.apiKey.count({ where: { tenantId, revokedAt: null } }),
    ]);

    const doneByAccount = new Map(publishedThisWeek.map((g) => [g.accountId, g._count._all]));
    const goalRows = await this.prisma.socialGoal.findMany({ where: { tenantId, accountId: { in: goalAccounts.map((a) => a.id) } } });
    const targetByAccount = new Map(goalRows.map((g) => [g.accountId, g.postsPerWeek]));
    const goals = goalAccounts.map((account) => ({
      accountId: account.id,
      account: toAccountSummary(account),
      target: targetByAccount.get(account.id) ?? 3,
      done: doneByAccount.get(account.id) ?? 0,
    }));

    const weekStreak = this.computeWeekStreak(publishedForStreak.map((t) => t.publishedAt!), tz, now);

    const commentTotal = commentWindow.length;
    const commentResolved = commentWindow.filter((c) => c.status === 'done' || c.repliedAt !== null).length;
    const commentScore = commentTotal === 0 ? 100 : Math.round((commentResolved / commentTotal) * 100);

    const mediaMap = await resolveMediaMap(this.prisma, this.resolver, tenantId, upNextRows.flatMap((r) => collectMediaIds(r)));
    const upNext = upNextRows.map((r) => toPostView(r, mediaMap));

    const recentComments: RecentCommentView[] = recentCommentRows.map((c) => ({
      id: c.id,
      accountId: c.accountId,
      account: toAccountSummary(c.account),
      platform: c.platform,
      kind: c.kind,
      status: c.status,
      authorName: c.authorName,
      authorHandle: c.authorHandle,
      authorAvatarUrl: c.authorAvatarUrl,
      body: c.body,
      permalink: c.permalink,
      rating: c.rating,
      fromUs: c.fromUs,
      createdAt: c.createdAt.toISOString(),
    }));

    return {
      weekStreak,
      goals,
      commentScore,
      counts: {
        queue: queueCount,
        drafts: draftsCount,
        approvals: approvalsCount,
        sentLast7d,
        failed: failedCount,
        openComments,
        unreadMessages: unreadMessages._sum.unreadCount ?? 0,
      },
      upNext,
      recentComments,
      firstSteps: { channelConnected: channelConnected > 0, postCreated: postCreated > 0, apiKeyCreated: apiKeyCreated > 0 },
    };
  }

  /** Consecutive weeks (current one included if it already has a post) with >=1 published target — CONTRACT.md §Home. */
  private computeWeekStreak(publishedAts: Date[], timezone: string, now: Date): number {
    const weeksWithPost = new Set(publishedAts.map((d) => startOfWeekUtc(d, timezone).getTime()));

    let cursor = startOfWeekUtc(now, timezone);
    if (!weeksWithPost.has(cursor.getTime())) {
      cursor = startOfWeekUtc(new Date(cursor.getTime() - 3 * 86400000), timezone); // step into last week, re-anchored (DST-safe)
    }

    let streak = 0;
    for (let i = 0; i < STREAK_LOOKBACK_WEEKS; i++) {
      if (!weeksWithPost.has(cursor.getTime())) break;
      streak++;
      cursor = startOfWeekUtc(new Date(cursor.getTime() - 3 * 86400000), timezone);
    }
    return streak;
  }
}
