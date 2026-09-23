import type { SocialAccount, SocialAccountMetricDaily, SocialPostTarget } from '@prisma/client';
import { engagementRate } from '@htownautos/social';
import { toAccountSummary, type AccountSummaryView } from '../posts/mappers';
import { metricsOf, targetEngagements } from './metrics-view.util';
import type { InsightsOverviewView } from './insights.types';

/** Guard against a pathological `from`/`to` spanning years — the series is meant to be day-by-day, not decade-by-decade. */
const MAX_SERIES_DAYS = 370;

function sumOrNull(values: (number | null | undefined)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0);
}

function combineSums(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function enumerateDates(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const days: string[] = [];
  for (let t = start.getTime(); t <= end.getTime() && days.length < MAX_SERIES_DAYS; t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

const EMPTY_TOTALS: InsightsOverviewView['totals'] = {
  followers: null,
  followersChange: null,
  impressions: null,
  reach: null,
  engagements: null,
  engagementRate: null,
  posts: 0,
  clicks: null,
};

/**
 * Pure aggregation for `GET /social/insights/overview` (CONTRACT.md §3.8):
 * `followersChange = last − first in range` per account (and summed for the
 * grand total), `engagements = likes+comments+shares+saves` from
 * `SocialPostTarget.metrics`, impressions/reach/clicks(-from-accounts) from
 * `SocialAccountMetricDaily`, clicks also merged in from post-target
 * metrics (§3.10's ShortUrl-backed clicks). Split out from
 * `SocialInsightsService.overview` so the aggregation math is testable
 * without a database.
 */
export function buildOverview(
  range: { from: string; to: string },
  accountIds: string[],
  accounts: SocialAccount[],
  dailyRows: SocialAccountMetricDaily[],
  targets: SocialPostTarget[],
): InsightsOverviewView {
  if (accountIds.length === 0) {
    return { range, totals: EMPTY_TOTALS, series: [], byAccount: [] };
  }

  const accountById = new Map(accounts.map((a) => [a.id, a]));

  // Series: one bucket per day, summed across accounts. A day with no rows for any account stays null (not 0).
  const days = enumerateDates(range.from, range.to);
  const seriesAgg = new Map(
    days.map((d) => [d, { followersSum: 0, followersSeen: false, impressionsSum: 0, impressionsSeen: false, engagementsSum: 0, engagementsSeen: false }]),
  );
  for (const row of dailyRows) {
    const agg = seriesAgg.get(dateKey(row.date));
    if (!agg) continue;
    if (row.followers != null) {
      agg.followersSum += row.followers;
      agg.followersSeen = true;
    }
    if (row.impressions != null) {
      agg.impressionsSum += row.impressions;
      agg.impressionsSeen = true;
    }
  }
  for (const target of targets) {
    if (!target.publishedAt) continue;
    const agg = seriesAgg.get(dateKey(target.publishedAt));
    if (!agg) continue;
    const eng = targetEngagements(target);
    if (eng != null) {
      agg.engagementsSum += eng;
      agg.engagementsSeen = true;
    }
  }
  const series = days.map((d) => {
    const agg = seriesAgg.get(d)!;
    return {
      date: d,
      followers: agg.followersSeen ? agg.followersSum : null,
      impressions: agg.impressionsSeen ? agg.impressionsSum : null,
      engagements: agg.engagementsSeen ? agg.engagementsSum : null,
    };
  });

  const impressionsTotal = sumOrNull(dailyRows.map((r) => r.impressions));
  const reachTotal = sumOrNull(dailyRows.map((r) => r.reach));
  const clicksFromDaily = sumOrNull(dailyRows.map((r) => r.clicks));
  const clicksFromTargets = sumOrNull(targets.map((t) => metricsOf(t)?.clicks ?? null));
  const clicksTotal = combineSums(clicksFromDaily, clicksFromTargets);
  const engagementsTotal = sumOrNull(targets.map((t) => targetEngagements(t)));
  const postsTotal = new Set(targets.map((t) => t.postId)).size;

  let followersTotal = 0;
  let anyFollowers = false;
  let followersChangeTotal = 0;
  let anyFollowersChange = false;
  const byAccount: { account: AccountSummaryView; followers: number | null; followersChange: number | null; impressions: number | null; engagements: number | null; posts: number }[] = [];

  for (const accountId of accountIds) {
    const account = accountById.get(accountId);
    if (!account) continue;

    const rowsForAccount = dailyRows.filter((r) => r.accountId === accountId);
    const withFollowers = rowsForAccount.filter((r) => r.followers != null);
    const firstF = withFollowers[0]?.followers ?? null;
    const lastF = withFollowers[withFollowers.length - 1]?.followers ?? null;
    const change = firstF != null && lastF != null ? lastF - firstF : null;
    if (lastF != null) {
      followersTotal += lastF;
      anyFollowers = true;
    }
    if (change != null) {
      followersChangeTotal += change;
      anyFollowersChange = true;
    }

    const targetsForAccount = targets.filter((t) => t.accountId === accountId);
    byAccount.push({
      account: toAccountSummary(account),
      followers: lastF,
      followersChange: change,
      impressions: sumOrNull(rowsForAccount.map((r) => r.impressions)),
      engagements: sumOrNull(targetsForAccount.map((t) => targetEngagements(t))),
      posts: targetsForAccount.length,
    });
  }

  return {
    range,
    totals: {
      followers: anyFollowers ? followersTotal : null,
      followersChange: anyFollowersChange ? followersChangeTotal : null,
      impressions: impressionsTotal,
      reach: reachTotal,
      engagements: engagementsTotal,
      engagementRate: engagementRate(engagementsTotal, reachTotal ?? impressionsTotal),
      posts: postsTotal,
      clicks: clicksTotal,
    },
    series,
    byAccount,
  };
}
