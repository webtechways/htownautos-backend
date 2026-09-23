import { socialFetch } from '../http/social-http';
import { sumEngagements, engagementRate } from './engagement';
import { NULL_POST_METRICS } from './types';
import type { AccountDailyMetrics, MetricsActionContext, MetricsAdapter, PostMetricsResult } from './types';

const THREADS_BASE = 'https://graph.threads.net/v1.0';

interface ThreadsInsightItem {
  name: string;
  values?: { value: number }[];
  total_value?: { value: number };
}
interface ThreadsInsightsResponse {
  data: ThreadsInsightItem[];
}

function metricValue(res: ThreadsInsightsResponse, name: string): number | null {
  const item = res.data.find((d) => d.name === name);
  if (!item) return null;
  if (typeof item.total_value?.value === 'number') return item.total_value.value;
  const v = item.values?.[item.values.length - 1]?.value;
  return typeof v === 'number' ? v : null;
}

async function fetchInsights(ctx: MetricsActionContext, path: string, metrics: string[], since?: string, until?: string): Promise<ThreadsInsightsResponse> {
  const url = new URL(`${THREADS_BASE}${path}`);
  url.searchParams.set('metric', metrics.join(','));
  if (since) url.searchParams.set('since', since);
  if (until) url.searchParams.set('until', until);
  url.searchParams.set('access_token', ctx.accessToken);
  const res = await socialFetch(url.toString(), { platform: 'threads' });
  return (await res.json()) as ThreadsInsightsResponse;
}

/**
 * Threads insights (CONTRACT.md §3.8/§4). `followers_count` is a lifetime
 * metric (no `since`/`until`), fetched separately from the day-bracketed
 * `views` metric.
 */
export const threadsMetricsAdapter: MetricsAdapter = {
  async accountDaily(ctx, date): Promise<AccountDailyMetrics> {
    const userId = ctx.account.platformAccountId;
    const until = new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);

    const [daily, followers] = await Promise.all([
      fetchInsights(ctx, `/${userId}/threads_insights`, ['views', 'likes', 'replies', 'reposts', 'quotes'], date, until),
      fetchInsights(ctx, `/${userId}/threads_insights`, ['followers_count']),
    ]);

    const engagements = sumEngagements(
      metricValue(daily, 'likes'),
      metricValue(daily, 'replies'),
      metricValue(daily, 'reposts'),
      metricValue(daily, 'quotes'),
    );

    return {
      followers: metricValue(followers, 'followers_count'),
      impressions: metricValue(daily, 'views'),
      reach: null,
      engagements,
      profileViews: null,
      videoViews: null,
      clicks: null,
    };
  },

  async postMetrics(ctx, target): Promise<PostMetricsResult> {
    if (!target.externalId) return NULL_POST_METRICS;
    const insights = await fetchInsights(ctx, `/${target.externalId}/insights`, ['views', 'likes', 'replies', 'reposts', 'quotes', 'shares']);

    const likes = metricValue(insights, 'likes');
    const comments = metricValue(insights, 'replies');
    const shares = sumEngagements(metricValue(insights, 'reposts'), metricValue(insights, 'quotes'), metricValue(insights, 'shares'), null);
    const impressions = metricValue(insights, 'views');
    const engagements = sumEngagements(likes, comments, shares, null);

    return {
      impressions,
      reach: null,
      likes,
      comments,
      shares,
      saves: null,
      clicks: null,
      videoViews: null,
      engagementRate: engagementRate(engagements, impressions),
    };
  },
};
