import type { SocialAccount, SocialPostTarget } from '@prisma/client';
import type { SocialAccountSecrets } from '../connect/types';

/** Everything a metrics adapter needs to call the platform on behalf of one account. Mirrors `CommunityActionContext`. */
export interface MetricsActionContext {
  account: SocialAccount;
  /** Live, non-expired token — already refreshed by `SocialTokenService.getAccessToken`. */
  accessToken: string;
  /** Decrypted `encryptedSecrets` (instance host for Mastodon, identifier/DID for Bluesky, etc.). */
  secrets: SocialAccountSecrets;
}

/** One day of account-level metrics — verbatim shape of `SocialAccountMetricDaily`'s metric columns. `null` when the platform doesn't expose that metric. */
export interface AccountDailyMetrics {
  followers: number | null;
  impressions: number | null;
  reach: number | null;
  engagements: number | null;
  profileViews: number | null;
  videoViews: number | null;
  clicks: number | null;
}

/** Verbatim shape of contract.ts `PostMetrics`. */
export interface PostMetricsResult {
  impressions: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
  videoViews: number | null;
  /** 0..1 */
  engagementRate: number | null;
}

export const NULL_ACCOUNT_DAILY: AccountDailyMetrics = {
  followers: null,
  impressions: null,
  reach: null,
  engagements: null,
  profileViews: null,
  videoViews: null,
  clicks: null,
};

export const NULL_POST_METRICS: PostMetricsResult = {
  impressions: null,
  reach: null,
  likes: null,
  comments: null,
  shares: null,
  saves: null,
  clicks: null,
  videoViews: null,
  engagementRate: null,
};

/**
 * One implementation per platform (`libs/social/src/insights/<platform>.metrics.ts`).
 * `accountDaily` returns today's (or `date`'s) snapshot for `SocialAccountMetricDaily`;
 * `postMetrics` returns metrics for one already-published `SocialPostTarget`. A
 * metric the platform doesn't expose is `null`, never a fabricated 0. Errors
 * propagate as `SocialApiError` — the data-sync job catches per-account/per-target
 * so one failure never stops the batch (CONTRACT.md §4) — except LinkedIn, which
 * turns a `PERMISSION` error (no Community Management approval) into an
 * all-null result instead of throwing, per this package's brief.
 */
export interface MetricsAdapter {
  /** `date` is `YYYY-MM-DD`, in UTC — the day the 03:00 America/Chicago cron snapshot represents. */
  accountDaily(ctx: MetricsActionContext, date: string): Promise<AccountDailyMetrics>;
  postMetrics(ctx: MetricsActionContext, target: SocialPostTarget): Promise<PostMetricsResult>;
}
