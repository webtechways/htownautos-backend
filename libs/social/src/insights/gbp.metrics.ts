import { socialFetch } from '../http/social-http';
import { NULL_POST_METRICS } from './types';
import type { AccountDailyMetrics, MetricsAdapter, PostMetricsResult } from './types';

const PERFORMANCE_BASE = 'https://businessprofileperformance.googleapis.com/v1';

const IMPRESSION_METRICS = ['BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH'];
const ENGAGEMENT_METRICS = ['BUSINESS_CONVERSATIONS', 'BUSINESS_DIRECTION_REQUESTS', 'BUSINESS_BOOKINGS'];
const CLICK_METRICS = ['CALL_CLICKS', 'WEBSITE_CLICKS'];

/** `platformAccountId` is a full "accounts/{id}/locations/{id}" resource name (see `gbp.reviews.ts`); the Performance API only wants the "locations/{id}" part. */
function locationName(platformAccountId: string): string {
  const match = platformAccountId.match(/locations\/.+$/);
  return match ? match[0] : platformAccountId;
}

interface DailyMetricTimeSeries {
  dailyMetric?: string;
  timeSeries?: { datedValues?: { value?: string }[] };
}
interface FetchMultiResponse {
  multiDailyMetricTimeSeries?: { dailyMetricTimeSeries?: DailyMetricTimeSeries[] }[];
}

function sumMetric(res: FetchMultiResponse, names: string[]): number | null {
  let total = 0;
  let found = false;
  for (const group of res.multiDailyMetricTimeSeries ?? []) {
    for (const series of group.dailyMetricTimeSeries ?? []) {
      if (!series.dailyMetric || !names.includes(series.dailyMetric)) continue;
      for (const dv of series.timeSeries?.datedValues ?? []) {
        if (dv.value != null) {
          total += Number(dv.value);
          found = true;
        }
      }
    }
  }
  return found ? total : null;
}

function dateParam(prefix: string, date: Date): string {
  return `${prefix}.year=${date.getUTCFullYear()}&${prefix}.month=${date.getUTCMonth() + 1}&${prefix}.day=${date.getUTCDate()}`;
}

/**
 * Google Business Profile Performance API (CONTRACT.md §1/§4). GBP has no
 * followers/reach/video concept — metrics are location interactions:
 * impressions = the four `BUSINESS_IMPRESSIONS_*` metrics summed, clicks =
 * call + website clicks, engagements = conversations/direction
 * requests/bookings summed. Local Post insights (per-post metrics) were
 * discontinued by Google — `postMetrics` always returns nulls; only
 * `accountDaily` is meaningful for this platform.
 */
export const gbpMetricsAdapter: MetricsAdapter = {
  async accountDaily(ctx, date): Promise<AccountDailyMetrics> {
    const location = locationName(ctx.account.platformAccountId);
    const d = new Date(`${date}T00:00:00Z`);

    const url = new URL(`${PERFORMANCE_BASE}/${location}:fetchMultiDailyMetricsTimeSeries`);
    for (const m of [...IMPRESSION_METRICS, ...ENGAGEMENT_METRICS, ...CLICK_METRICS]) {
      url.searchParams.append('dailyMetrics', m);
    }
    const rangeQuery = `${dateParam('dailyRange.start_date', d)}&${dateParam('dailyRange.end_date', d)}`;

    const res = await socialFetch(`${url.toString()}&${rangeQuery}`, { platform: 'gbp', headers: { Authorization: `Bearer ${ctx.accessToken}` } });
    const data = (await res.json()) as FetchMultiResponse;

    return {
      followers: null,
      impressions: sumMetric(data, IMPRESSION_METRICS),
      reach: null,
      engagements: sumMetric(data, ENGAGEMENT_METRICS),
      profileViews: null,
      videoViews: null,
      clicks: sumMetric(data, CLICK_METRICS),
    };
  },

  async postMetrics(): Promise<PostMetricsResult> {
    return NULL_POST_METRICS;
  },
};
