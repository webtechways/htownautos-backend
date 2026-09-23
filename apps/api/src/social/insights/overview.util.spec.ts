import type { SocialAccount, SocialAccountMetricDaily, SocialPostTarget } from '@prisma/client';
import { buildOverview, enumerateDates } from './overview.util';

function account(overrides: Partial<SocialAccount>): SocialAccount {
  return {
    id: 'acc-1',
    tenantId: 'tenant-1',
    platform: 'facebook',
    platformAccountId: 'ext-1',
    name: 'My Page',
    username: null,
    avatarUrl: null,
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: null,
    scopes: [],
    pageId: null,
    isActive: true,
    lastSyncAt: null,
    lastErrorAt: null,
    lastErrorMsg: null,
    metaValue: null,
    accountType: 'page',
    publishMethod: 'api',
    status: 'active',
    profileUrl: null,
    encryptedSecrets: null,
    webhookSubscribedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  } as SocialAccount;
}

function dailyRow(overrides: Partial<SocialAccountMetricDaily>): SocialAccountMetricDaily {
  return {
    id: 'row-1',
    tenantId: 'tenant-1',
    accountId: 'acc-1',
    date: new Date('2026-08-01'),
    followers: null,
    impressions: null,
    reach: null,
    engagements: null,
    profileViews: null,
    videoViews: null,
    clicks: null,
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
    ...overrides,
  } as SocialAccountMetricDaily;
}

function target(overrides: Partial<SocialPostTarget>): SocialPostTarget {
  return {
    id: 'target-1',
    tenantId: 'tenant-1',
    postId: 'post-1',
    accountId: 'acc-1',
    status: 'published',
    content: null,
    mediaOverride: null,
    options: {},
    thread: [],
    firstComment: null,
    scheduledAt: null,
    slotted: false,
    publishedAt: new Date('2026-08-01T12:00:00Z'),
    externalId: 'ext-post-1',
    externalUrl: null,
    error: null,
    attempts: 0,
    lockedAt: null,
    nextAttemptAt: null,
    metrics: null,
    metricsUpdatedAt: null,
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
    ...overrides,
  } as SocialPostTarget;
}

describe('enumerateDates', () => {
  it('returns every day inclusive of both ends', () => {
    expect(enumerateDates('2026-08-01', '2026-08-03')).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
  });

  it('a single-day range returns one entry', () => {
    expect(enumerateDates('2026-08-01', '2026-08-01')).toEqual(['2026-08-01']);
  });
});

describe('buildOverview aggregation', () => {
  const range = { from: '2026-08-01', to: '2026-08-02' };

  it('empty account list returns an all-null/zero shell, not an error', () => {
    const result = buildOverview(range, [], [], [], []);
    expect(result.totals).toEqual({
      followers: null,
      followersChange: null,
      impressions: null,
      reach: null,
      engagements: null,
      engagementRate: null,
      posts: 0,
      clicks: null,
    });
    expect(result.series).toEqual([]);
    expect(result.byAccount).toEqual([]);
  });

  it('followersChange = last - first in range, summed into totals.followersChange', () => {
    const acc = account({});
    const rows = [
      dailyRow({ id: 'r1', date: new Date('2026-08-01'), followers: 100 }),
      dailyRow({ id: 'r2', date: new Date('2026-08-02'), followers: 130 }),
    ];
    const result = buildOverview(range, ['acc-1'], [acc], rows, []);

    expect(result.byAccount[0].followers).toBe(130);
    expect(result.byAccount[0].followersChange).toBe(30);
    expect(result.totals.followers).toBe(130);
    expect(result.totals.followersChange).toBe(30);
  });

  it('engagements = likes+comments+shares+saves, summed from published target metrics (not from account-level rows)', () => {
    const acc = account({});
    const t1 = target({ id: 't1', postId: 'post-1', publishedAt: new Date('2026-08-01T10:00:00Z'), metrics: { likes: 5, comments: 2, shares: 1, saves: 0, impressions: 100, reach: 80, clicks: null, videoViews: null, engagementRate: null } as unknown as SocialPostTarget['metrics'] });
    const t2 = target({ id: 't2', postId: 'post-2', publishedAt: new Date('2026-08-02T10:00:00Z'), metrics: { likes: 3, comments: 1, shares: 0, saves: 1, impressions: 50, reach: 40, clicks: null, videoViews: null, engagementRate: null } as unknown as SocialPostTarget['metrics'] });

    const result = buildOverview(range, ['acc-1'], [acc], [], [t1, t2]);

    expect(result.totals.engagements).toBe(8 + 5); // (5+2+1+0) + (3+1+0+1)
    expect(result.totals.posts).toBe(2);
    expect(result.byAccount[0].engagements).toBe(13);
    expect(result.byAccount[0].posts).toBe(2);
    expect(result.series.find((s) => s.date === '2026-08-01')?.engagements).toBe(8);
    expect(result.series.find((s) => s.date === '2026-08-02')?.engagements).toBe(5);
  });

  it('clicks combine SocialAccountMetricDaily.clicks and target metrics.clicks (CONTRACT.md §3.10)', () => {
    const acc = account({});
    const rows = [dailyRow({ clicks: 4 })];
    const t1 = target({ metrics: { clicks: 6, likes: null, comments: null, shares: null, saves: null, impressions: null, reach: null, videoViews: null, engagementRate: null } as unknown as SocialPostTarget['metrics'] });

    const result = buildOverview(range, ['acc-1'], [acc], rows, [t1]);
    expect(result.totals.clicks).toBe(10);
  });

  it('a metric with no data anywhere in range stays null, never 0', () => {
    const acc = account({});
    const result = buildOverview(range, ['acc-1'], [acc], [], []);
    expect(result.totals.impressions).toBeNull();
    expect(result.totals.reach).toBeNull();
    expect(result.totals.clicks).toBeNull();
    expect(result.totals.followers).toBeNull();
  });

  it('posts count is distinct SocialPost ids, not target count (one post can target multiple accounts)', () => {
    const acc = account({});
    const t1 = target({ id: 't1', postId: 'shared-post' });
    const t2 = target({ id: 't2', postId: 'shared-post', accountId: 'acc-1' });
    const result = buildOverview(range, ['acc-1'], [acc], [], [t1, t2]);
    expect(result.totals.posts).toBe(1);
  });
});
