import { VehicleHistoryReportExtract } from './types';

/**
 * Semantic checks beyond what the JSON schema can enforce. A failure here is
 * treated the same as an API error by the consumer (retried, then logged
 * `invalid_output`) — a model that violates these is more likely to have
 * hallucinated than to represent a real edge case.
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateReport(report: VehicleHistoryReportExtract): string[] {
  const errors: string[] = [];

  if (report.millage !== null && report.millage < 0) errors.push('millage < 0');

  for (const owner of report.owners_history) {
    if (owner.owner_no < 1) errors.push(`owner_no < 1 (got ${owner.owner_no})`);
    if (owner.purchased !== null && !isValidDate(owner.purchased)) {
      errors.push(`owner ${owner.owner_no}: invalid purchased date "${owner.purchased}"`);
    }
    if (owner.millage !== null && owner.millage < 0) errors.push(`owner ${owner.owner_no}: millage < 0`);

    for (const [i, row] of owner.history_table.entries()) {
      if (row.date !== null && !isValidDate(row.date)) {
        errors.push(`owner ${owner.owner_no} row ${i}: invalid date "${row.date}"`);
      }
      if (row.millage !== null && row.millage < 0) {
        errors.push(`owner ${owner.owner_no} row ${i}: millage < 0`);
      }
    }
  }

  return errors;
}

function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}
