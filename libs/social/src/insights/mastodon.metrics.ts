import { socialFetch, SocialApiError } from '../http/social-http';
import { NULL_POST_METRICS } from './types';
import type { AccountDailyMetrics, MetricsActionContext, MetricsAdapter, PostMetricsResult } from './types';

function instanceOf(ctx: MetricsActionContext): string {
  const host = ctx.secrets.instance as string | undefined;
  if (!host) {
    throw new SocialApiError({ platform: 'mastodon', httpStatus: 0, kind: 'NOT_CONFIGURED', message: 'Cuenta de Mastodon sin instancia guardada — reconectar' });
  }
  return host;
}

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/**
 * Mastodon counts (CONTRACT.md §1/§4). Per-instance API, no impressions
 * concept — `verify_credentials` gives followers, the status object gives
 * favourites/reblogs/replies for one post.
 */
export const mastodonMetricsAdapter: MetricsAdapter = {
  async accountDaily(ctx): Promise<AccountDailyMetrics> {
    const res = await socialFetch(`https://${instanceOf(ctx)}/api/v1/accounts/verify_credentials`, {
      platform: 'mastodon',
      headers: authHeaders(ctx.accessToken),
    });
    const data = (await res.json()) as { followers_count?: number };

    return {
      followers: data.followers_count ?? null,
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
    const res = await socialFetch(`https://${instanceOf(ctx)}/api/v1/statuses/${target.externalId}`, {
      platform: 'mastodon',
      headers: authHeaders(ctx.accessToken),
    });
    const data = (await res.json()) as { favourites_count?: number; reblogs_count?: number; replies_count?: number };

    const likes = data.favourites_count ?? null;
    const shares = data.reblogs_count ?? null;
    const comments = data.replies_count ?? null;

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
