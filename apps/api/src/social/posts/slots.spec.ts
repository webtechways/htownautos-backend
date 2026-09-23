import { DEFAULT_SCHEDULE_SLOTS, emptySlotsInRange, generateOccurrences, nextFreeSlot, nextSlot, occurrencesFrom, startOfWeekUtc } from './slots';

const CHICAGO = { timezone: 'America/Chicago', slots: DEFAULT_SCHEDULE_SLOTS };

describe('generateOccurrences', () => {
  it('returns the next Mon/Wed/Fri 09:00/13:00/17:00 slots after a Monday morning', () => {
    // 2026-09-21 is a Monday. 08:00 Central (UTC-5, CDT in September) = 13:00 UTC.
    const after = new Date('2026-09-21T13:00:00.000Z');
    const occ = generateOccurrences(CHICAGO, after, 3);
    expect(occ).toHaveLength(3);
    // 09:00 CDT = 14:00 UTC, 13:00 CDT = 18:00 UTC, 17:00 CDT = 22:00 UTC.
    expect(occ[0].toISOString()).toBe('2026-09-21T14:00:00.000Z');
    expect(occ[1].toISOString()).toBe('2026-09-21T18:00:00.000Z');
    expect(occ[2].toISOString()).toBe('2026-09-21T22:00:00.000Z');
  });

  it('skips the weekend (Fri 17:00 -> Mon 09:00)', () => {
    // Friday 2026-09-25, right after the 17:00 CDT slot (22:00 UTC).
    const after = new Date('2026-09-25T22:00:00.000Z');
    const [next] = generateOccurrences(CHICAGO, after, 1);
    // Next Monday is 2026-09-28, 09:00 CDT = 14:00 UTC.
    expect(next.toISOString()).toBe('2026-09-28T14:00:00.000Z');
  });

  it('is DST-safe across the November "fall back" boundary (CDT -05:00 -> CST -06:00)', () => {
    // 2026-11-01 is a Sunday; DST ends 2026-11-01 in the US. Start from the Friday before.
    const after = new Date('2026-10-30T22:00:00.000Z'); // Fri 17:00 CDT
    const occ = generateOccurrences(CHICAGO, after, 3);
    // Next Monday 2026-11-02 is already CST (UTC-6): 09:00 CST = 15:00 UTC.
    expect(occ[0].toISOString()).toBe('2026-11-02T15:00:00.000Z');
    expect(occ[1].toISOString()).toBe('2026-11-02T19:00:00.000Z');
    expect(occ[2].toISOString()).toBe('2026-11-02T23:00:00.000Z');
  });

  it('returns [] when there are no slots at all', () => {
    expect(generateOccurrences({ timezone: 'America/Chicago', slots: [] }, new Date(), 5)).toEqual([]);
  });
});

describe('nextFreeSlot', () => {
  it('skips occupied instants and returns the first free one', () => {
    const after = new Date('2026-09-21T13:00:00.000Z'); // Monday 08:00 CDT
    const first3 = generateOccurrences(CHICAGO, after, 3).map((d) => d.getTime());
    const occupied = new Set([first3[0], first3[1]]);
    const free = nextFreeSlot(CHICAGO, after, occupied);
    expect(free.getTime()).toBe(first3[2]);
  });

  it('returns the very first slot when nothing is occupied', () => {
    const after = new Date('2026-09-21T13:00:00.000Z');
    const [expected] = generateOccurrences(CHICAGO, after, 1);
    expect(nextFreeSlot(CHICAGO, after, new Set()).getTime()).toBe(expected.getTime());
  });
});

describe('nextSlot', () => {
  it('returns the first occurrence regardless of occupancy', () => {
    const after = new Date('2026-09-21T13:00:00.000Z');
    const [expected] = generateOccurrences(CHICAGO, after, 1);
    expect(nextSlot(CHICAGO, after).getTime()).toBe(expected.getTime());
  });
});

describe('occurrencesFrom (mode=next cascade)', () => {
  it('gives consecutive slots for the new target + N existing ones to shift', () => {
    const after = new Date('2026-09-21T13:00:00.000Z');
    const chain = occurrencesFrom(CHICAGO, after, 4);
    expect(chain).toHaveLength(4);
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i].getTime()).toBeGreaterThan(chain[i - 1].getTime());
    }
  });
});

describe('emptySlotsInRange', () => {
  it('lists every unoccupied slot within the range', () => {
    const from = new Date('2026-09-21T00:00:00.000Z'); // Monday
    const to = new Date('2026-09-23T23:59:59.000Z'); // Wednesday
    const all = emptySlotsInRange(CHICAGO, from, to, new Set());
    // Mon + Tue + Wed, 3 slots/day = 9.
    expect(all).toHaveLength(9);
    expect(all.every((d) => d.getTime() >= from.getTime() && d.getTime() <= to.getTime())).toBe(true);
  });

  it('excludes occupied instants', () => {
    const from = new Date('2026-09-21T00:00:00.000Z');
    const to = new Date('2026-09-21T23:59:59.000Z'); // just Monday: 3 slots
    const [first] = emptySlotsInRange(CHICAGO, from, to, new Set());
    const occupied = new Set([first.getTime()]);
    const rest = emptySlotsInRange(CHICAGO, from, to, occupied);
    expect(rest).toHaveLength(2);
    expect(rest.some((d) => d.getTime() === first.getTime())).toBe(false);
  });

  it('returns [] for an inverted or empty range', () => {
    const from = new Date('2026-09-21T12:00:00.000Z');
    const to = new Date('2026-09-21T00:00:00.000Z');
    expect(emptySlotsInRange(CHICAGO, from, to, new Set())).toEqual([]);
  });
});

describe('startOfWeekUtc', () => {
  it('anchors mid-week to that week\'s Monday 00:00 Central', () => {
    // Wednesday 2026-09-23, 15:00 UTC (10:00 CDT).
    const wed = new Date('2026-09-23T15:00:00.000Z');
    const monday = startOfWeekUtc(wed, 'America/Chicago');
    // Monday 2026-09-21, 00:00 CDT = 05:00 UTC.
    expect(monday.toISOString()).toBe('2026-09-21T05:00:00.000Z');
  });

  it('is idempotent on a Monday itself', () => {
    const mondayNoon = new Date('2026-09-21T17:00:00.000Z'); // Monday noon CDT
    expect(startOfWeekUtc(mondayNoon, 'America/Chicago').toISOString()).toBe('2026-09-21T05:00:00.000Z');
  });

  it('stays correct across the DST fall-back boundary', () => {
    // Wednesday 2026-11-04 (already CST, UTC-6) — that week's Monday is 2026-11-02, also CST.
    const wed = new Date('2026-11-04T18:00:00.000Z');
    expect(startOfWeekUtc(wed, 'America/Chicago').toISOString()).toBe('2026-11-02T06:00:00.000Z');
  });
});
