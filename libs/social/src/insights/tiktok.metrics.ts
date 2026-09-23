import { socialFetch } from '../http/social-http';
import { sumEngagements, engagementRate } from './engagement';
import { NULL_POST_METRICS } from './types';
import type { AccountDailyMetrics, MetricsAdapter, PostMetricsResult } from './types';

function headers(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
}

interface TikTokVideoStats {
  id: string;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
  view_count?: number;
}

/**
 * TikTok stats (CONTRACT.md §1/§4). The Display/Content Posting API has no
 * day-partitioned analytics — `GET /v2/user/info/` and `POST /v2/video/query/`
 * return lifetime totals, so `accountDaily.followers` is a daily snapshot of
 * the current `follower_count` (same pattern as Facebook's `fan_count`);
 * everything else account-level is `null` (no impressions/reach exposed to
 * non-Ads apps).
 */
export const tiktokMetricsAdapter: MetricsAdapter = {
  async accountDaily(ctx): Promise<AccountDailyMetrics> {
    const url = new URL('https://open.tiktokapis.com/v2/user/info/');
    url.searchParams.set('fields', 'follower_count');
    const res = await socialFetch(url.toString(), { platform: 'tiktok', headers: headers(ctx.accessToken) });
    const data = (await res.json()) as { data?: { user?: { follower_count?: number } } };

    return {
      followers: data.data?.user?.follower_count ?? null,
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
    const url = new URL('https://open.tiktokapis.com/v2/video/query/');
    url.searchParams.set('fields', 'id,like_count,comment_count,share_count,view_count');
    const res = await socialFetch(url.toString(), {
      platform: 'tiktok',
      method: 'POST',
      headers: headers(ctx.accessToken),
      body: JSON.stringify({ filters: { video_ids: [target.externalId] } }),
    });
    const data = (await res.json()) as { data?: { videos?: TikTokVideoStats[] } };
    const video = data.data?.videos?.[0];
    if (!video) return NULL_POST_METRICS;

    const likes = video.like_count ?? null;
    const comments = video.comment_count ?? null;
    const shares = video.share_count ?? null;
    const videoViews = video.view_count ?? null;
    const engagements = sumEngagements(likes, comments, shares, null);

    return {
      impressions: null,
      reach: null,
      likes,
      comments,
      shares,
      saves: null,
      clicks: null,
      videoViews,
      engagementRate: engagementRate(engagements, videoViews),
    };
  },
};
