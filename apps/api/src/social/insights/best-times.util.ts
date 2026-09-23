/** Verbatim shape of contract.ts `BestTimeCell`. */
export interface BestTimeCellView {
  day: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  hour: number;
  score: number;
  posts: number;
}

export interface BestTimePost {
  publishedAt: Date;
  /** likes + comments + shares + saves for this published target. */
  engagement: number;
}

/** Fewer published posts than this and there's no signal — fall back to `source: "default"` (CONTRACT.md §3.8). */
export const MIN_POSTS_FOR_HISTORY = 10;

/** Generic "best practice" peak hours used for the default heatmap: mid-morning, lunch, after-work, evening. */
const DEFAULT_PEAK_HOURS = new Set([8, 12, 17, 20]);

const WEEKDAY_ORDER = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Day-of-week (0=Sun) and hour (0-23) of `date` as observed in `timezone`. */
export function dayHourInTimezone(date: Date, timezone: string): { day: 0 | 1 | 2 | 3 | 4 | 5 | 6; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(date);
  const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0';
  const dayIdx = WEEKDAY_ORDER.indexOf(weekdayStr);
  let hour = parseInt(hourStr, 10);
  if (Number.isNaN(hour) || hour === 24) hour = 0;
  return { day: (dayIdx < 0 ? 0 : dayIdx) as 0 | 1 | 2 | 3 | 4 | 5 | 6, hour };
}

/** Flat 7×24 default heatmap (no history yet): stronger on weekday peak hours, softer on weekends. */
export function defaultBestTimeCells(): BestTimeCellView[] {
  const cells: BestTimeCellView[] = [];
  for (let day = 0; day <= 6; day++) {
    const isWeekend = day === 0 || day === 6;
    for (let hour = 0; hour < 24; hour++) {
      const isPeak = DEFAULT_PEAK_HOURS.has(hour);
      const score = isPeak ? (isWeekend ? 0.6 : 1) : isWeekend ? 0.2 : 0.3;
      cells.push({ day: day as BestTimeCellView['day'], hour, score, posts: 0 });
    }
  }
  return cells;
}

/**
 * Buckets `posts` by (day, hour) in `timezone`, scores each bucket by its
 * average engagement relative to the account's own busiest bucket (0..1),
 * and fills all 168 cells (empty buckets score 0). Below
 * {@link MIN_POSTS_FOR_HISTORY} posts, returns the platform-default heatmap
 * instead (CONTRACT.md §3.8).
 */
export function computeBestTimes(posts: BestTimePost[], timezone: string): { source: 'history' | 'default'; cells: BestTimeCellView[] } {
  if (posts.length < MIN_POSTS_FOR_HISTORY) {
    return { source: 'default', cells: defaultBestTimeCells() };
  }

  const buckets = new Map<string, { total: number; count: number }>();
  for (const post of posts) {
    const { day, hour } = dayHourInTimezone(post.publishedAt, timezone);
    const key = `${day}:${hour}`;
    const bucket = buckets.get(key) ?? { total: 0, count: 0 };
    bucket.total += post.engagement;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  let maxAvg = 0;
  for (const bucket of buckets.values()) {
    const avg = bucket.total / bucket.count;
    if (avg > maxAvg) maxAvg = avg;
  }

  const cells: BestTimeCellView[] = [];
  for (let day = 0; day <= 6; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const bucket = buckets.get(`${day}:${hour}`);
      const avg = bucket ? bucket.total / bucket.count : 0;
      cells.push({ day: day as BestTimeCellView['day'], hour, score: maxAvg > 0 ? avg / maxAvg : 0, posts: bucket?.count ?? 0 });
    }
  }
  return { source: 'history', cells };
}
