import type { ScheduleSlot } from '@htownautos/social';

/**
 * Pure slot math for the posting queue (CONTRACT.md §3.3): where the next
 * "queue" slot is, what "next" (insert + shift) means, and enumerating empty
 * slots for the calendar view. No DB access here — callers (posts.service,
 * queue.service) feed it a schedule + already-occupied instants and get back
 * plain `Date`s.
 *
 * Timezone handling is DST-safe via `Intl.DateTimeFormat`, not a fixed UTC
 * offset table: a slot's wall-clock time (e.g. "09:00 America/Chicago") maps
 * to a different UTC instant depending on the calendar date (CDT vs CST).
 */

export interface ScheduleConfig {
  timezone: string;
  slots: ScheduleSlot[];
}

/** Used whenever a channel has no `SocialPostingSchedule` row yet (CONTRACT.md §3.3). */
export const DEFAULT_SLOT_TIMES = ['09:00', '13:00', '17:00'];
/** Mon–Fri. */
export const DEFAULT_SLOT_DAYS = [1, 2, 3, 4, 5] as const;

export const DEFAULT_SCHEDULE_SLOTS: ScheduleSlot[] = DEFAULT_SLOT_DAYS.flatMap((day) =>
  DEFAULT_SLOT_TIMES.map((time) => ({ day: day as ScheduleSlot['day'], time })),
);

const MAX_DAYS_LOOKAHEAD = 120;

/**
 * Effective slot list for a channel that has NO `SocialPostingSchedule` row
 * yet -> the Mon–Fri 9/13/17 default. Once a row exists, its `slots` (even
 * `[]`, meaning the tenant cleared every slot) is used as-is — callers pass
 * `row?.slots ?? null` here, not `row?.slots` directly, so "no row" and "row
 * with zero slots" stay distinguishable.
 */
export function effectiveSlots(slots: ScheduleSlot[] | null): ScheduleSlot[] {
  return slots ?? DEFAULT_SCHEDULE_SLOTS;
}

/** Minutes to ADD to a UTC instant to get local wall-clock time in `timeZone` (i.e. localTime = instant + offset). */
function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  const hour = map.hour === '24' ? 0 : Number(map.hour);
  const asUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), hour, Number(map.minute), Number(map.second));
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** `{year, month, day}` of `instant` as seen in `timeZone` (calendar date, timezone-aware). */
function localDateParts(instant: Date, timeZone: string): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

/** UTC instant for wall-clock `y-m-d hh:mm` in `timeZone`. Two-pass to stay correct across a DST boundary. */
function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset1 = tzOffsetMinutes(new Date(guess), timeZone);
  const candidate = guess - offset1 * 60000;
  const offset2 = tzOffsetMinutes(new Date(candidate), timeZone);
  return new Date(guess - offset2 * 60000);
}

/** Calendar weekday (0=Sun..6=Sat) of a Y-M-D triple — timezone-independent once you have the triple. */
function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Adds `days` to a Y-M-D triple; relies on `Date.UTC` normalizing overflow (e.g. day 32 -> next month). */
function addDays(year: number, month: number, day: number, days: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * Chronological slot instants strictly after `after`, up to `count` of them.
 * Walks calendar days forward (timezone-aware weekday), evaluating each
 * day's slots in time order.
 */
export function generateOccurrences(config: ScheduleConfig, after: Date, count: number): Date[] {
  const slots = config.slots;
  const timezone = config.timezone || 'America/Chicago';
  if (slots.length === 0 || count <= 0) return [];

  const results: Date[] = [];
  const start = localDateParts(after, timezone);

  for (let dayOffset = 0; dayOffset <= MAX_DAYS_LOOKAHEAD && results.length < count; dayOffset++) {
    const { year, month, day } = addDays(start.year, start.month, start.day, dayOffset);
    const weekday = weekdayOf(year, month, day);
    const daySlots = slots.filter((s) => s.day === weekday).sort((a, b) => a.time.localeCompare(b.time));

    for (const slot of daySlots) {
      const [hh, mm] = slot.time.split(':').map(Number);
      const instant = zonedTimeToUtc(year, month, day, hh, mm, timezone);
      if (instant.getTime() > after.getTime()) {
        results.push(instant);
        if (results.length >= count) break;
      }
    }
  }

  return results;
}

/**
 * `mode=queue`: the channel's next free slot after `now` — free = no other
 * target of that channel already sits at that exact minute (`occupied`).
 */
export function nextFreeSlot(config: ScheduleConfig, after: Date, occupied: ReadonlySet<number>): Date {
  const BATCH = 50;
  const MAX_BATCHES = 10; // up to 500 candidate occurrences (~4 months at 3 slots/weekday) before giving up
  for (let batch = 1; batch <= MAX_BATCHES; batch++) {
    const candidates = generateOccurrences(config, after, BATCH * batch);
    for (const candidate of candidates) {
      if (!occupied.has(candidate.getTime())) return candidate;
    }
  }
  throw new Error('No free posting slot found in the lookahead window — every slot is occupied');
}

/** `mode=next`: the very first slot occurrence after `after`, occupied or not. */
export function nextSlot(config: ScheduleConfig, after: Date): Date {
  const [first] = generateOccurrences(config, after, 1);
  if (!first) throw new Error('No posting slot configured');
  return first;
}

/**
 * `mode=next`'s cascade: `count` consecutive slot occurrences starting at the
 * first one after `after`. Index 0 is where the new target lands; index 1..n
 * are where the previously-queued targets (sorted by their old time) move to.
 */
export function occurrencesFrom(config: ScheduleConfig, after: Date, count: number): Date[] {
  return generateOccurrences(config, after, count);
}

/**
 * UTC instant of Monday 00:00 local time in `timeZone`, for the week
 * containing `instant`. Used by the Home endpoint's week streak/goal
 * counters — grouping by this instant (not a string key) stays correct
 * across a DST boundary because it's re-derived from the calendar date each
 * time, never by adding a fixed 7×86400000ms to a previous result.
 */
export function startOfWeekUtc(instant: Date, timeZone: string): Date {
  const { year, month, day } = localDateParts(instant, timeZone);
  const weekday = weekdayOf(year, month, day); // 0=Sun..6=Sat
  const daysSinceMonday = (weekday + 6) % 7;
  const monday = addDays(year, month, day, -daysSinceMonday);
  return zonedTimeToUtc(monday.year, monday.month, monday.day, 0, 0, timeZone);
}

/** Empty (unoccupied) slots in `[from, to]` — `GET /social/queue/slots`. */
export function emptySlotsInRange(config: ScheduleConfig, from: Date, to: Date, occupied: ReadonlySet<number>): Date[] {
  const slots = config.slots;
  const timezone = config.timezone || 'America/Chicago';
  if (slots.length === 0 || to.getTime() <= from.getTime()) return [];

  const results: Date[] = [];
  const start = localDateParts(from, timezone);
  const totalDays = Math.min(MAX_DAYS_LOOKAHEAD, Math.ceil((to.getTime() - from.getTime()) / 86400000) + 2);

  for (let dayOffset = 0; dayOffset <= totalDays; dayOffset++) {
    const { year, month, day } = addDays(start.year, start.month, start.day, dayOffset);
    const weekday = weekdayOf(year, month, day);
    const daySlots = slots.filter((s) => s.day === weekday).sort((a, b) => a.time.localeCompare(b.time));

    for (const slot of daySlots) {
      const [hh, mm] = slot.time.split(':').map(Number);
      const instant = zonedTimeToUtc(year, month, day, hh, mm, timezone);
      if (instant.getTime() >= from.getTime() && instant.getTime() <= to.getTime() && !occupied.has(instant.getTime())) {
        results.push(instant);
      }
    }
  }

  return results.sort((a, b) => a.getTime() - b.getTime());
}
