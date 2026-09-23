import { socialFetch, SocialApiError } from '../http/social-http';
import { NULL_ACCOUNT_DAILY, NULL_POST_METRICS } from './types';
import type { AccountDailyMetrics, MetricsActionContext, MetricsAdapter, PostMetricsResult } from './types';

const REST_BASE = 'https://api.linkedin.com/rest';
const LINKEDIN_VERSION = process.env.LINKEDIN_API_VERSION || '202502';

function headers(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'LinkedIn-Version': LINKEDIN_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
  };
}

function orgUrn(ctx: MetricsActionContext): string {
  return `urn:li:organization:${ctx.account.platformAccountId}`;
}

interface FollowerStatsElement {
  followerCounts?: { organicFollowerCount?: number; paidFollowerCount?: number };
}
interface FollowerStatsResponse {
  elements?: FollowerStatsElement[];
}

interface ShareStatsElement {
  totalShareStatistics?: {
    clickCount?: number;
    commentCount?: number;
    engagement?: number;
    impressionCount?: number;
    likeCount?: number;
    shareCount?: number;
  };
}
interface ShareStatsResponse {
  elements?: ShareStatsElement[];
}

/**
 * LinkedIn organization stats (CONTRACT.md §1/§4). Both endpoints need
 * Community Management API approval (`r_organization_social` /
 * `rw_organization_admin`, already in `LINKEDIN_SCOPES`) — a tenant without
 * approval always gets a 403 `PERMISSION` here, so per this package's brief
 * that error is turned into an all-null result (not thrown) so the job
 * doesn't spin retrying an org that will never be approved.
 *
 * `organizationalEntityFollowerStatistics` and `organizationalEntityShareStatistics`
 * only give LIFETIME totals when queried without `timeIntervals` (the
 * time-bound variant of the follower endpoint exists but the share endpoint
 * explicitly does not support it) — `accountDaily` therefore snapshots the
 * lifetime total each day rather than a true daily delta, same pattern as
 * Facebook's `fan_count`/TikTok's `follower_count`. `postMetrics` maps
 * cleanly onto `totalShareStatistics` per share.
 */
export const linkedinMetricsAdapter: MetricsAdapter = {
  async accountDaily(ctx): Promise<AccountDailyMetrics> {
    try {
      const url = new URL(`${REST_BASE}/organizationalEntityFollowerStatistics`);
      url.searchParams.set('q', 'organizationalEntity');
      url.searchParams.set('organizationalEntity', orgUrn(ctx));
      const res = await socialFetch(url.toString(), { platform: 'linkedin', headers: headers(ctx.accessToken) });
      const data = (await res.json()) as FollowerStatsResponse;

      const followers = (data.elements ?? []).reduce((sum, el) => {
        const c = el.followerCounts;
        return sum + (c?.organicFollowerCount ?? 0) + (c?.paidFollowerCount ?? 0);
      }, 0);

      return { ...NULL_ACCOUNT_DAILY, followers };
    } catch (err) {
      if (err instanceof SocialApiError && err.kind === 'PERMISSION') return NULL_ACCOUNT_DAILY;
      throw err;
    }
  },

  async postMetrics(ctx, target): Promise<PostMetricsResult> {
    if (!target.externalId) return NULL_POST_METRICS;
    try {
      const url = new URL(`${REST_BASE}/organizationalEntityShareStatistics`);
      url.searchParams.set('q', 'organizationalEntity');
      url.searchParams.set('organizationalEntity', orgUrn(ctx));
      url.searchParams.set('shares', `List(${target.externalId})`);
      const res = await socialFetch(url.toString(), { platform: 'linkedin', headers: headers(ctx.accessToken) });
      const data = (await res.json()) as ShareStatsResponse;
      const stats = data.elements?.[0]?.totalShareStatistics;
      if (!stats) return NULL_POST_METRICS;

      return {
        impressions: stats.impressionCount ?? null,
        reach: null,
        likes: stats.likeCount ?? null,
        comments: stats.commentCount ?? null,
        shares: stats.shareCount ?? null,
        saves: null,
        clicks: stats.clickCount ?? null,
        videoViews: null,
        engagementRate: typeof stats.engagement === 'number' ? Math.min(1, stats.engagement) : null,
      };
    } catch (err) {
      if (err instanceof SocialApiError && err.kind === 'PERMISSION') return NULL_POST_METRICS;
      throw err;
    }
  },
};
