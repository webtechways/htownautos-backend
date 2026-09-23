import { socialFetch } from '../http/social-http';
import { sumEngagements, engagementRate } from './engagement';
import { NULL_POST_METRICS } from './types';
import type { AccountDailyMetrics, MetricsAdapter, PostMetricsResult } from './types';

const API_BASE = 'https://api.x.com/2';

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

interface XPublicMetrics {
  followers_count?: number;
  retweet_count?: number;
  reply_count?: number;
  like_count?: number;
  quote_count?: number;
  bookmark_count?: number;
  impression_count?: number;
}

/**
 * X public metrics (CONTRACT.md §1/§4: "public metrics", needs a paid API
 * tier for anything beyond the tweet's own `public_metrics`). No account-level
 * impressions/reach endpoint on the free/basic tiers — only the follower
 * count from the user object is populated for `accountDaily`.
 */
export const xMetricsAdapter: MetricsAdapter = {
  async accountDaily(ctx): Promise<AccountDailyMetrics> {
    const url = new URL(`${API_BASE}/users/${ctx.account.platformAccountId}`);
    url.searchParams.set('user.fields', 'public_metrics');
    const res = await socialFetch(url.toString(), { platform: 'x', headers: authHeaders(ctx.accessToken) });
    const data = (await res.json()) as { data?: { public_metrics?: XPublicMetrics } };

    return {
      followers: data.data?.public_metrics?.followers_count ?? null,
      impressions: null,
      reach: null,
      engagements: null,
      profileViews: null,
      videoViews: null,
      clicks: null,
    };
  },

  async postMetrics(ctx, target): Promise<PostMetricsResult> {
    if (!target.externalId) return NULL_POST_METRICS;
    const url = new URL(`${API_BASE}/tweets/${target.externalId}`);
    url.searchParams.set('tweet.fields', 'public_metrics');
    const res = await socialFetch(url.toString(), { platform: 'x', headers: authHeaders(ctx.accessToken) });
    const data = (await res.json()) as { data?: { public_metrics?: XPublicMetrics } };
    const m = data.data?.public_metrics ?? {};

    const likes = m.like_count ?? null;
    const comments = m.reply_count ?? null;
    const shares = sumEngagements(m.retweet_count ?? null, m.quote_count ?? null, null, null);
    const saves = m.bookmark_count ?? null;
    const impressions = m.impression_count ?? null;
    const engagements = sumEngagements(likes, comments, shares, saves);

    return {
      impressions,
      reach: null,
      likes,
      comments,
      shares,
      saves,
      clicks: null,
      videoViews: null,
      engagementRate: engagementRate(engagements, impressions),
    };
  },
};
