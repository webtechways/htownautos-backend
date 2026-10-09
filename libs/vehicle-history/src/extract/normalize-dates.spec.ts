import { normalizeDateString, normalizeReportDates } from './normalize-dates';
import { VehicleHistoryReportExtract } from './types';

describe('normalizeDateString', () => {
  it('passes through a valid ISO date', () => {
    expect(normalizeDateString('2020-03-21')).toBe('2020-03-21');
  });

  it('expands YYYY-MM to day 01', () => {
    expect(normalizeDateString('2020-03')).toBe('2020-03-01');
  });

  it('converts MM-DD-YYYY (the format gpt-4o-mini actually returned) to ISO', () => {
    expect(normalizeDateString('03-21-2020')).toBe('2020-03-21');
  });

  it('converts MM/DD/YYYY to ISO', () => {
    expect(normalizeDateString('03/21/2020')).toBe('2020-03-21');
  });

  it('converts MM/YYYY to ISO day 01', () => {
    expect(normalizeDateString('03/2020')).toBe('2020-03-01');
  });

  it('converts MM-YYYY to ISO day 01', () => {
    expect(normalizeDateString('03-2020')).toBe('2020-03-01');
  });

  it('returns null for null/empty input', () => {
    expect(normalizeDateString(null)).toBeNull();
    expect(normalizeDateString('')).toBeNull();
    expect(normalizeDateString('   ')).toBeNull();
  });

  it('returns null (never throws) for an unparseable or impossible date instead of failing the report', () => {
    expect(normalizeDateString('not a date')).toBeNull();
    expect(normalizeDateString('13-45-2020')).toBeNull();
    expect(normalizeDateString('2020-02-30')).toBeNull();
  });
});

describe('normalizeReportDates', () => {
  it('normalizes owners_history.purchased and every history_table row date', () => {
    const report: VehicleHistoryReportExtract = {
      millage: 1000,
      accident: false,
      title: 'Clean Title',
      value: null,
      service_history_record: null,
      at_last_open_recall: null,
      last_owner_state: null,
      owners_history: [
        {
          owner_no: 1,
          purchased: '03-21-2020',
          type_of_owner: 'Personal',
          millage: 500,
          history_table: [
            {
              date: '04/01/2021',
              millage: 600,
              source: 'dmv',
              comment: 'test',
              damage_type: null,
              if_damage: null,
              flooded: false,
              burn: false,
              bandalist: false,
              teaft: false,
              total_lost: false,
              salvage_issue: false,
            },
          ],
        },
      ],
    };

    const result = normalizeReportDates(report);
    expect(result.owners_history[0].purchased).toBe('2020-03-21');
    expect(result.owners_history[0].history_table[0].date).toBe('2021-04-01');
  });
});
