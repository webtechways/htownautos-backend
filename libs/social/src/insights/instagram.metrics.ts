import { socialFetch } from '../http/social-http';
import { graphUrl } from '../connect/meta-graph';
import { sumEngagements, engagementRate } from './engagement';
import { NULL_POST_METRICS } from './types';
import type { AccountDailyMetrics, MetricsActionContext, MetricsAdapter, PostMetricsResult } from './types';

interface IgInsightValue {
  value: number;
}
interface IgInsightItem {
  name: string;
  values?: IgInsightValue[];
  total_value?: { value: number };
}
interface IgInsightsResponse {
  data: IgInsightItem[];
}

function metricValue(res: IgInsightsResponse, name: string): number | null {
  const item = res.data.find((d) => d.name === name);
  if (!item) return null;
  if (typeof item.total_value?.value === 'number') return item.total_value.value;
  const v = item.values?.[item.values.length - 1]?.value;
  return typeof v === 'number' ? v : null;
}

async function fetchInsights(ctx: MetricsActionContext, path: string, metrics: string[], since?: string, until?: string): Promise<IgInsightsResponse> {
  const url = new URL(graphUrl(path));
  url.searchParams.set('metric', metrics.join(','));
  if (since) url.searchParams.set('since', since);
  if (until) url.searchParams.set('until', until);
  url.searchParams.set('access_token', ctx.accessToken);
  const res = await socialFetch(url.toString(), { platform: 'instagram' });
  return (await res.json()) as IgInsightsResponse;
}

/**
 * Instagram Graph API insights (works for both the Facebook-Login and
 * Instagram-Login connect paths — both store an `ig-user-id` as
 * `platformAccountId`). Uses `views` rather than the retired `impressions`
 * metric (deprecated for IG insights since Graph v22; this package's
 * `META_GRAPH_VERSION` default is v23.0) — kept conservative (only
 * long-stable metric names) since Graph fails the WHOLE insights call if a
 * single requested metric is invalid for that account/media type.
 */
export const instagramMetricsAdapter: MetricsAdapter = {
  async accountDaily(ctx, date): Promise<AccountDailyMetrics> {
    const igUserId = ctx.account.platformAccountId;
    const until = new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
    const insights = await fetchInsights(ctx, `/${igUserId}/insights`, ['reach', 'views', 'profile_views', 'follower_count'], date, until);

    return {
      followers: metricValue(insights, 'follower_count'),
      impressions: metricValue(insights, 'views'),
      reach: metricValue(insights, 'reach'),
      engagements: null,
      profileViews: metricValue(insights, 'profile_views'),
      videoViews: null,
      clicks: null,
    };
  },

  async postMetrics(ctx, target): Promise<PostMetricsResult> {
    if (!target.externalId) return NULL_POST_METRICS;
    const insights = await fetchInsights(ctx, `/${target.externalId}/insights`, ['views', 'reach', 'likes', 'comments', 'shares', 'saved']);

    const likes = metricValue(insights, 'likes');
    const comments = metricValue(insights, 'comments');
    const shares = metricValue(insights, 'shares');
    const saves = metricValue(insights, 'saved');
    const reach = metricValue(insights, 'reach');
    const impressions = metricValue(insights, 'views');
    const engagements = sumEngagements(likes, comments, shares, saves);

    return {
      impressions,
      reach,
      likes,
      comments,
      shares,
      saves,
      clicks: null,
      videoViews: null,
      engagementRate: engagementRate(engagements, reach ?? impressions),
    };
  },
};
