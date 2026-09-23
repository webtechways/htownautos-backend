import { socialFetch } from '../http/social-http';
import { sumEngagements } from './engagement';
import { NULL_POST_METRICS } from './types';
import type { AccountDailyMetrics, MetricsAdapter, PostMetricsResult } from './types';

const XRPC = 'https://bsky.social/xrpc';

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/**
 * Bluesky (AT Protocol) counts (CONTRACT.md §1/§4). No impressions/reach
 * concept is exposed publicly — `getProfile` gives followers, `getPostThread`
 * gives like/repost/reply/quote counts for one post. `target.externalId` is
 * the post's AT-URI (as stored by the publisher).
 */
export const blueskyMetricsAdapter: MetricsAdapter = {
  async accountDaily(ctx): Promise<AccountDailyMetrics> {
    const url = new URL(`${XRPC}/app.bsky.actor.getProfile`);
    url.searchParams.set('actor', ctx.account.platformAccountId);
    const res = await socialFetch(url.toString(), { platform: 'bluesky', headers: authHeaders(ctx.accessToken) });
    const data = (await res.json()) as { followersCount?: number };

    return {
      followers: data.followersCount ?? null,
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
    const url = new URL(`${XRPC}/app.bsky.feed.getPostThread`);
    url.searchParams.set('uri', target.externalId);
    url.searchParams.set('depth', '0');
    const res = await socialFetch(url.toString(), { platform: 'bluesky', headers: authHeaders(ctx.accessToken) });
    const data = (await res.json()) as {
      thread?: { post?: { likeCount?: number; repostCount?: number; replyCount?: number; quoteCount?: number } };
    };
    const post = data.thread?.post;
    if (!post) return NULL_POST_METRICS;

    const likes = post.likeCount ?? null;
    const comments = post.replyCount ?? null;
    const shares = sumEngagements(post.repostCount ?? null, post.quoteCount ?? null, null, null);

    return {
      impressions: null,
      reach: null,
      likes,
      comments,
      shares,
      saves: null,
      clicks: null,
      videoViews: null,
      engagementRate: null,
    };
  },
};
