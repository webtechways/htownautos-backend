import { copartLaneCodes, effectiveCalendarStatus, roomCodeOf, timeStatus } from './calendar-status';

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
