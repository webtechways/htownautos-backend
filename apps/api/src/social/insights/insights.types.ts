import type { AccountSummaryView } from '../posts/mappers';
import type { PostMetricsResult } from '@htownautos/social';
import type { BestTimeCellView } from './best-times.util';

/** Verbatim shape of contract.ts `InsightsOverview`. */
export interface InsightsOverviewView {
  range: { from: string; to: string };
  totals: {
    followers: number | null;
    followersChange: number | null;
    impressions: number | null;
    reach: number | null;
    engagements: number | null;
    engagementRate: number | null;
    posts: number;
    clicks: number | null;
  };
  series: { date: string; followers: number | null; impressions: number | null; engagements: number | null }[];
  byAccount: {
    account: AccountSummaryView;
    followers: number | null;
    followersChange: number | null;
    impressions: number | null;
    engagements: number | null;
    posts: number;
  }[];
}

/** Verbatim shape of contract.ts `PostInsightRow`. */
export interface PostInsightRowView {
  post: { id: string; content: string; mediaUrl: string | null };
  target: {
    id: string;
    accountId: string;
    account: AccountSummaryView;
    publishedAt: string | null;
    externalUrl: string | null;
    metrics: PostMetricsResult | null;
  };
}

/** Verbatim shape of contract.ts `BestTimes`. */
export interface BestTimesView {
  accountId: string;
  timezone: string;
  source: 'history' | 'default';
  cells: BestTimeCellView[];
}
