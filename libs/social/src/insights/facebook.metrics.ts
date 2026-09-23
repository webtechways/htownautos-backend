import { socialFetch } from '../http/social-http';
import { graphUrl } from '../connect/meta-graph';
import { sumEngagements, engagementRate } from './engagement';
import { NULL_POST_METRICS } from './types';
import type { AccountDailyMetrics, MetricsActionContext, MetricsAdapter, PostMetricsResult } from './types';

interface FbInsightValue {
  value: number;
}
interface FbInsightItem {
  name: string;
  values: FbInsightValue[];
}
interface FbInsightsResponse {
  data: FbInsightItem[];
}

function metricValue(res: FbInsightsResponse, name: string): number | null {
  const item = res.data.find((d) => d.name === name);
  const v = item?.values?.[item.values.length - 1]?.value;
  return typeof v === 'number' ? v : null;
}

async function fetchInsights(ctx: MetricsActionContext, objectId: string, metrics: string[], since?: string, until?: string): Promise<FbInsightsResponse> {
  const url = new URL(graphUrl(`/${objectId}/insights`));
  url.searchParams.set('metric', metrics.join(','));
  url.searchParams.set('period', 'day');
  if (since) url.searchParams.set('since', since);
  if (until) url.searchParams.set('until', until);
  url.searchParams.set('access_token', ctx.accessToken);
  const res = await socialFetch(url.toString(), { platform: 'facebook' });
  return (await res.json()) as FbInsightsResponse;
}

/**
 * Facebook Page insights (CONTRACT.md §3.8/§4). Account daily uses
 * `/{page-id}/insights` (day period, `since`/`until` bracketing `date`) plus
 * the Page node's own `fan_count` field for followers (the `page_fans`
 * insights metric was retired; `fan_count` is the stable replacement). Post
 * metrics combine `/{post-id}/insights` with the post node's own
 * likes/comments/shares summary fields (no separate insights metric for
 * those three).
 */
export const facebookMetricsAdapter: MetricsAdapter = {
  async accountDaily(ctx, date): Promise<AccountDailyMetrics> {
    const pageId = ctx.account.platformAccountId;
    const until = new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);

    const [insights, fanCount] = await Promise.all([
      fetchInsights(ctx, pageId, ['page_impressions', 'page_impressions_unique', 'page_post_engagements', 'page_views_total'], date, until),
      (async () => {
        const url = new URL(graphUrl(`/${pageId}`));
        url.searchParams.set('fields', 'fan_count');
        url.searchParams.set('access_token', ctx.accessToken);
        const res = await socialFetch(url.toString(), { platform: 'facebook' });
        const data = (await res.json()) as { fan_count?: number };
        return typeof data.fan_count === 'number' ? data.fan_count : null;
      })(),
    ]);

    return {
      followers: fanCount,
      impressions: metricValue(insights, 'page_impressions'),
      reach: metricValue(insights, 'page_impressions_unique'),
      engagements: metricValue(insights, 'page_post_engagements'),
      profileViews: metricValue(insights, 'page_views_total'),
      videoViews: null,
      clicks: null,
    };
  },

  async postMetrics(ctx, target): Promise<PostMetricsResult> {
    if (!target.externalId) return NULL_POST_METRICS;

    const [insights, node] = await Promise.all([
      fetchInsights(ctx, target.externalId, ['post_impressions', 'post_impressions_unique', 'post_video_views']),
      (async () => {
        const url = new URL(graphUrl(`/${target.externalId}`));
        url.searchParams.set('fields', 'likes.summary(true),comments.summary(true),shares');
        url.searchParams.set('access_token', ctx.accessToken);
        const res = await socialFetch(url.toString(), { platform: 'facebook' });
        return (await res.json()) as {
          likes?: { summary?: { total_count?: number } };
          comments?: { summary?: { total_count?: number } };
          shares?: { count?: number };
        };
      })(),
    ]);

    const likes = node.likes?.summary?.total_count ?? null;
    const comments = node.comments?.summary?.total_count ?? null;
    const shares = node.shares?.count ?? null;
    const reach = metricValue(insights, 'post_impressions_unique');
    const impressions = metricValue(insights, 'post_impressions');
    const engagements = sumEngagements(likes, comments, shares, null);

    return {
      impressions,
      reach,
      likes,
      comments,
      shares,
      saves: null,
      clicks: null,
      videoViews: metricValue(insights, 'post_video_views'),
      engagementRate: engagementRate(engagements, reach ?? impressions),
    };
  },
};
