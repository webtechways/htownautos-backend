import { copartLaneCodes, effectiveCalendarStatus, idleLanes, promoteCalendarByTime, roomCodeOf, timeStatus } from './calendar-status';

describe('roomCodeOf', () => {
  it('maps Solace and IAAI sale rooms to broadcast room codes', () => {
    expect(roomCodeOf('COPART159E')).toBe('copart-159-e');
    expect(roomCodeOf('COPART024A')).toBe('copart-24-a');
    expect(roomCodeOf('IAA441E')).toBe('iaa-441-e');
  });
  it('keeps broadcast codes, dropping leading zeros', () => {
    expect(roomCodeOf('copart-194-d')).toBe('copart-194-d');
    expect(roomCodeOf('iaa-643-c')).toBe('iaa-643-c');
    expect(roomCodeOf('copart-025-a')).toBe('copart-25-a');
  });
  it('takes the first usable candidate', () => {
    expect(roomCodeOf(undefined, '', 'COPART7B')).toBe('copart-7-b');
    expect(roomCodeOf(null, 'nope')).toBeNull();
  });
});

describe('effectiveCalendarStatus', () => {
  const now = Date.UTC(2026, 9, 8, 18);
  const at = (h: number) => new Date(now + h * 3_600_000);
  it('manual wins over everything', () => {
    expect(effectiveCalendarStatus({ startedAt: at(-1), endedAt: at(0), manualStatus: 'live' }, now)).toBe('live');
    expect(effectiveCalendarStatus({ startedAt: at(2), manualStatus: 'ended' }, now)).toBe('ended');
  });
  it('ENDAUC or calendar "ended" end it', () => {
    expect(effectiveCalendarStatus({ startedAt: at(-1), endedAt: at(0) }, now)).toBe('ended');
    expect(effectiveCalendarStatus({ startedAt: at(-1), status: 'ended' }, now)).toBe('ended');
  });
  it('falls back to time', () => {
    expect(timeStatus(at(1), now)).toBe('upcoming');
    // 15 min antes del comienzo ya cuenta como en vivo
    expect(timeStatus(new Date(now - 0 + 14 * 60_000), now)).toBe('live');
    expect(timeStatus(new Date(now + 16 * 60_000), now)).toBe('upcoming');
    expect(timeStatus(at(-2), now)).toBe('live');
    expect(timeStatus(at(-9), now)).toBe('ended');
  });
});

describe('copartLaneCodes', () => {
  it('builds codes from raw.lanes', () => {
    expect(copartLaneCodes(159, { lanes: [{ lane: 'A' }, { lane: 'b' }, { lane: 'A' }, { lane: '' }] })).toEqual([
      'copart-159-a',
      'copart-159-b',
    ]);
    expect(copartLaneCodes(1, null)).toEqual([]);
  });
});

describe('idleLanes', () => {
  const now = Date.UTC(2026, 9, 8, 18);
  const ago = (min: number) => new Date(now - min * 60_000);
  const startedAt = ago(120);
  it('ends a lane idle past the threshold while capture is healthy', () => {
    const r = idleLanes({
      lanes: ['copart-1-a', 'copart-1-b'],
      alreadyEnded: [],
      lastActivity: new Map([['copart-1-a', ago(25)], ['copart-1-b', ago(1)]]),
      startedAt, now, captureHealthy: true,
    });
    expect(r.newlyEnded).toEqual(['copart-1-a']);
    expect(r.allEnded).toBe(false);
  });
  it('waits much longer when capture looks down', () => {
    const r = idleLanes({
      lanes: ['copart-1-a'], alreadyEnded: [], lastActivity: new Map([['copart-1-a', ago(25)]]),
      startedAt, now, captureHealthy: false,
    });
    expect(r.newlyEnded).toEqual([]);
  });
  it('ends the auction when every lane is done; silent lanes only after the no-show window', () => {
    const base = { lastActivity: new Map([['copart-1-a', ago(30)]]), now, captureHealthy: true };
    expect(idleLanes({ ...base, lanes: ['copart-1-a', 'copart-1-b'], alreadyEnded: [], startedAt }).allEnded).toBe(false);
    const r = idleLanes({ ...base, lanes: ['copart-1-a', 'copart-1-b'], alreadyEnded: [], startedAt: ago(200) });
    expect(r.allEnded).toBe(true);
    expect(r.lastAt?.getTime()).toBe(ago(30).getTime());
  });
  it('no known lanes never ends the auction', () => {
    expect(idleLanes({ lanes: [], alreadyEnded: [], lastActivity: new Map(), startedAt, now, captureHealthy: true }).allEnded).toBe(false);
  });
});

describe('promoteCalendarByTime', () => {
  it('pasa a live lo que empieza en 15 min y a ended lo de mas de 8 h, sin tocar lo manual', async () => {
    const updateMany = jest.fn().mockResolvedValueOnce({ count: 3 }).mockResolvedValueOnce({ count: 1 });
    const now = Date.UTC(2026, 9, 8, 0, 50);
    const out = await promoteCalendarByTime({ auctionCalendarEntry: { updateMany } }, now);
    expect(out).toEqual({ live: 3, ended: 1 });
    const [live, ended] = updateMany.mock.calls.map((c) => c[0]);
    expect(live.data).toEqual({ status: 'live' });
    expect(live.where.manualStatus).toBeNull();
    expect(live.where.endedAt).toBeNull();
    expect(live.where.startedAt.lte).toEqual(new Date(now + 15 * 60_000));
    expect(ended.where.startedAt.lte).toEqual(new Date(now - 8 * 3_600_000));
  });
});
