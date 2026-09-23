import { computeCommentScore, type CommentStatsRow } from './stats';

function row(overrides: Partial<CommentStatsRow>): CommentStatsRow {
  return { status: 'open', repliedAt: null, platformCreatedAt: new Date('2026-01-01T00:00:00.000Z'), ...overrides };
}

describe('computeCommentScore', () => {
  it('returns 0 / null on an empty window', () => {
    expect(computeCommentScore([])).toEqual({ commentScore: 0, avgResponseMinutes: null });
  });

  it('counts done and replied rows as handled, ignores open+unreplied', () => {
    const rows: CommentStatsRow[] = [
      row({ status: 'done' }),
      row({ status: 'open', repliedAt: new Date('2026-01-01T01:00:00.000Z') }),
      row({ status: 'open' }),
      row({ status: 'open' }),
    ];
    // 2 of 4 handled = 50%
    expect(computeCommentScore(rows).commentScore).toBe(50);
  });

  it('rounds to the nearest whole percent', () => {
    const rows: CommentStatsRow[] = [row({ status: 'done' }), row({ status: 'open' }), row({ status: 'open' })];
    // 1 of 3 = 33.33... -> 33
    expect(computeCommentScore(rows).commentScore).toBe(33);
  });

  it('averages response time in minutes across only the replied rows', () => {
    const created = new Date('2026-01-01T00:00:00.000Z');
    const rows: CommentStatsRow[] = [
      row({ platformCreatedAt: created, repliedAt: new Date(created.getTime() + 10 * 60_000) }),
      row({ platformCreatedAt: created, repliedAt: new Date(created.getTime() + 30 * 60_000) }),
      row({ platformCreatedAt: created, repliedAt: null }), // unreplied — excluded from the average
    ];
    expect(computeCommentScore(rows).avgResponseMinutes).toBe(20);
  });

  it('avgResponseMinutes is null when nothing has been replied to yet', () => {
    const rows: CommentStatsRow[] = [row({ status: 'open' }), row({ status: 'open' })];
    expect(computeCommentScore(rows).avgResponseMinutes).toBeNull();
  });
});
