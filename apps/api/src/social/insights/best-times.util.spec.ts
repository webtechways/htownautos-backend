import { computeBestTimes, defaultBestTimeCells, dayHourInTimezone, MIN_POSTS_FOR_HISTORY } from './best-times.util';

describe('best-times scoring', () => {
  it('falls back to the default heatmap below MIN_POSTS_FOR_HISTORY', () => {
    const posts = Array.from({ length: MIN_POSTS_FOR_HISTORY - 1 }, (_, i) => ({
      publishedAt: new Date(Date.UTC(2026, 0, 5, 12 + i)), // Mon 2026-01-05
      engagement: 10,
    }));
    const result = computeBestTimes(posts, 'UTC');
    expect(result.source).toBe('default');
    expect(result.cells).toEqual(defaultBestTimeCells());
    expect(result.cells).toHaveLength(168);
  });

  it('scores history once there are at least MIN_POSTS_FOR_HISTORY posts, normalized 0..1 against the busiest bucket', () => {
    // 10 posts Monday 12:00 UTC with engagement 100, 2 posts Tuesday 09:00 UTC with engagement 10.
    const posts = [
      ...Array.from({ length: 10 }, () => ({ publishedAt: new Date(Date.UTC(2026, 0, 5, 12)), engagement: 100 })),
      ...Array.from({ length: 2 }, () => ({ publishedAt: new Date(Date.UTC(2026, 0, 6, 9)), engagement: 10 })),
    ];
    const result = computeBestTimes(posts, 'UTC');
    expect(result.source).toBe('history');
    expect(result.cells).toHaveLength(168);

    const monday12 = result.cells.find((c) => c.day === 1 && c.hour === 12)!;
    const tuesday9 = result.cells.find((c) => c.day === 2 && c.hour === 9)!;
    const emptyCell = result.cells.find((c) => c.day === 3 && c.hour === 3)!;

    expect(monday12.posts).toBe(10);
    expect(monday12.score).toBe(1); // busiest bucket normalizes to 1
    expect(tuesday9.posts).toBe(2);
    expect(tuesday9.score).toBeCloseTo(10 / 100);
    expect(emptyCell.posts).toBe(0);
    expect(emptyCell.score).toBe(0);
  });

  it('every score stays within 0..1', () => {
    const posts = Array.from({ length: 40 }, (_, i) => ({
      publishedAt: new Date(Date.UTC(2026, 0, 1 + (i % 7), i % 24)),
      engagement: Math.floor(Math.random() * 500),
    }));
    const { cells } = computeBestTimes(posts, 'UTC');
    for (const cell of cells) {
      expect(cell.score).toBeGreaterThanOrEqual(0);
      expect(cell.score).toBeLessThanOrEqual(1);
    }
  });

  it('dayHourInTimezone converts across a timezone offset (not just UTC)', () => {
    // 2026-01-05T02:00:00Z is Sunday night UTC but Monday 20:00 in Los Angeles is wrong direction —
    // use a date where UTC and America/Chicago disagree on both day and hour.
    const d = new Date('2026-01-05T02:00:00Z'); // Mon 02:00 UTC
    const utc = dayHourInTimezone(d, 'UTC');
    const chicago = dayHourInTimezone(d, 'America/Chicago'); // UTC-6 in January -> Sun 20:00
    expect(utc).toEqual({ day: 1, hour: 2 });
    expect(chicago).toEqual({ day: 0, hour: 20 });
  });
});
