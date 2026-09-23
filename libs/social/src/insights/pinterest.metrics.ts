import { socialFetch } from '../http/social-http';
import { engagementRate } from './engagement';
import { NULL_POST_METRICS } from './types';
import type { AccountDailyMetrics, MetricsAdapter, PostMetricsResult } from './types';

const BASE = 'https://api.pinterest.com/v5';
const MAX_LOOKBACK_DAYS = 90;

function headers(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

interface PinterestAnalyticsResponse {
  all?: { summary_metrics?: Record<string, number> };
}

function clampDate(d: Date, minDate: Date): string {
  return (d < minDate ? minDate : d).toISOString().slice(0, 10);
}

/**
 * Pinterest organic analytics (CONTRACT.md §1/§4): `user_account/analytics`
 * for the account, `pins/{pin_id}/analytics` per pin. Both take a
 * `start_date`/`end_date` range (max 90 days) and a `metric_types` list, and
 * return `all.summary_metrics` (aggregate over the range) — no separate
 * "reach" concept, `IMPRESSION` is the closest equivalent. `follower_count`
 * comes from the plain `user_account` node (current snapshot).
 */
export const pinterestMetricsAdapter: MetricsAdapter = {
  async accountDaily(ctx, date): Promise<AccountDailyMetrics> {
    const [analytics, account] = await Promise.all([
      (async () => {
        const url = new URL(`${BASE}/user_account/analytics`);
        url.searchParams.set('start_date', date);
        url.searchParams.set('end_date', date);
        for (const m of ['IMPRESSION', 'ENGAGEMENT', 'PIN_CLICK', 'OUTBOUND_CLICK']) url.searchParams.append('metric_types', m);
        const res = await socialFetch(url.toString(), { platform: 'pinterest', headers: headers(ctx.accessToken) });
        return (await res.json()) as PinterestAnalyticsResponse;
      })(),
      (async () => {
        const url = new URL(`${BASE}/user_account`);
        const res = await socialFetch(url.toString(), { platform: 'pinterest', headers: headers(ctx.accessToken) });
        return (await res.json()) as { follower_count?: number };
      })(),
    ]);

    const m = analytics.all?.summary_metrics ?? {};
    const clicks = (m.PIN_CLICK ?? 0) + (m.OUTBOUND_CLICK ?? 0);

    return {
      followers: account.follower_count ?? null,
      impressions: m.IMPRESSION ?? null,
      reach: null,
      engagements: m.ENGAGEMENT ?? null,
      profileViews: null,
      videoViews: null,
      clicks: m.PIN_CLICK != null || m.OUTBOUND_CLICK != null ? clicks : null,
    };
  },

  async postMetrics(ctx, target): Promise<PostMetricsResult> {
    if (!target.externalId) return NULL_POST_METRICS;
    const now = new Date();
    const minDate = new Date(now.getTime() - MAX_LOOKBACK_DAYS * 86_400_000);
    const startDate = clampDate(target.publishedAt ?? minDate, minDate);
    const endDate = now.toISOString().slice(0, 10);

    const url = new URL(`${BASE}/pins/${target.externalId}/analytics`);
    url.searchParams.set('start_date', startDate);
    url.searchParams.set('end_date', endDate);
    for (const m of ['IMPRESSION', 'SAVE', 'PIN_CLICK', 'OUTBOUND_CLICK']) url.searchParams.append('metric_types', m);
    const res = await socialFetch(url.toString(), { platform: 'pinterest', headers: headers(ctx.accessToken) });
    const data = (await res.json()) as PinterestAnalyticsResponse;
    const m = data.all?.summary_metrics ?? {};

    const impressions = m.IMPRESSION ?? null;
    const saves = m.SAVE ?? null;
    const clicks = m.PIN_CLICK != null || m.OUTBOUND_CLICK != null ? (m.PIN_CLICK ?? 0) + (m.OUTBOUND_CLICK ?? 0) : null;

    return {
      impressions,
      reach: null,
      likes: null,
      comments: null,
      shares: null,
      saves,
      clicks,
      videoViews: null,
      engagementRate: engagementRate(saves, impressions),
    };
  },
};
