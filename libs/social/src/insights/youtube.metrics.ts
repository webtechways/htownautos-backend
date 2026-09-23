import { socialFetch } from '../http/social-http';
import { engagementRate, sumEngagements } from './engagement';
import { NULL_POST_METRICS } from './types';
import type { AccountDailyMetrics, MetricsAdapter, PostMetricsResult } from './types';

const BASE = 'https://www.googleapis.com/youtube/v3';

function headers(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/**
 * YouTube Data API v3 (CONTRACT.md §1/§4, scoped to `videos.list` statistics
 * + channel subscriber count — the full YouTube Analytics API is out of
 * scope here). `channels.list` `statistics.viewCount` is a lifetime total,
 * snapshotted daily into `videoViews` (same pattern as Facebook's
 * `fan_count`); true impressions/reach/profile views aren't exposed by the
 * Data API.
 */
export const youtubeMetricsAdapter: MetricsAdapter = {
  async accountDaily(ctx): Promise<AccountDailyMetrics> {
    const url = new URL(`${BASE}/channels`);
    url.searchParams.set('part', 'statistics');
    url.searchParams.set('id', ctx.account.platformAccountId);
    const res = await socialFetch(url.toString(), { platform: 'youtube', headers: headers(ctx.accessToken) });
    const data = (await res.json()) as { items?: { statistics?: { subscriberCount?: string; viewCount?: string } }[] };
    const stats = data.items?.[0]?.statistics;

    return {
      followers: stats?.subscriberCount != null ? Number(stats.subscriberCount) : null,
      impressions: null,
      reach: null,
      engagements: null,
      profileViews: null,
      videoViews: stats?.viewCount != null ? Number(stats.viewCount) : null,
      clicks: null,
    };
  },

  async postMetrics(ctx, target): Promise<PostMetricsResult> {
    if (!target.externalId) return NULL_POST_METRICS;
    const url = new URL(`${BASE}/videos`);
    url.searchParams.set('part', 'statistics');
    url.searchParams.set('id', target.externalId);
    const res = await socialFetch(url.toString(), { platform: 'youtube', headers: headers(ctx.accessToken) });
    const data = (await res.json()) as { items?: { statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }[] };
    const stats = data.items?.[0]?.statistics;
    if (!stats) return NULL_POST_METRICS;

    const likes = stats.likeCount != null ? Number(stats.likeCount) : null;
    const comments = stats.commentCount != null ? Number(stats.commentCount) : null;
    const videoViews = stats.viewCount != null ? Number(stats.viewCount) : null;
    const engagements = sumEngagements(likes, comments, null, null);

    return {
      impressions: null,
      reach: null,
      likes,
      comments,
      shares: null,
      saves: null,
      clicks: null,
      videoViews,
      engagementRate: engagementRate(engagements, videoViews),
    };
  },
};
