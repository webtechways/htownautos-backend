import { VehicleHistoryReportExtract } from './types';

/**
 * gpt-4o-mini sometimes ignores the "YYYY-MM-DD" instruction and returns
 * MM-DD-YYYY/MM/DD/YYYY (observed: 58 rows, all failed `validate.ts`). Run
 * this on every extraction result *before* validation so a model date-format
 * slip degrades to `null` (a field we already treat as "unknown") instead of
 * failing the whole report and burning a retry.
 */
const ISO_FULL = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH = /^(\d{4})-(\d{2})$/;
const US_FULL = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;
const US_MONTH_YEAR = /^(\d{1,2})[/-](\d{4})$/;

export function normalizeDateString(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  if (v.length === 0) return null;

  let y: number, m: number, d: number;

  let match = v.match(ISO_FULL);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
    return isValidYmd(y, m, d) ? toIso(y, m, d) : null;
  }

  match = v.match(ISO_MONTH);
  if (match) {
    [y, m] = [Number(match[1]), Number(match[2])];
    return isValidYmd(y, m, 1) ? toIso(y, m, 1) : null;
  }

  // MM-DD-YYYY or MM/DD/YYYY (month-first, the format the model actually returned).
  match = v.match(US_FULL);
  if (match) {
    [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    return isValidYmd(y, m, d) ? toIso(y, m, d) : null;
  }

  // MM/YYYY or MM-YYYY.
  match = v.match(US_MONTH_YEAR);
  if (match) {
    [m, y] = [Number(match[1]), Number(match[2])];
    return isValidYmd(y, m, 1) ? toIso(y, m, 1) : null;
  }

  return null;
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function toIso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Returns a new report with every date field normalized (or nulled, never thrown). */
export function normalizeReportDates(report: VehicleHistoryReportExtract): VehicleHistoryReportExtract {
  return {
    ...report,
    owners_history: report.owners_history.map((owner) => ({
      ...owner,
      purchased: normalizeDateString(owner.purchased),
      history_table: owner.history_table.map((row) => ({
        ...row,
        date: normalizeDateString(row.date),
      })),
    })),
  };
}
