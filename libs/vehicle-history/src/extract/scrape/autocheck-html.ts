import { parseAutocheckText, stripAutocheckHtmlToText } from '../../parse/autocheck';
import { OwnerHistory, TitleBrand, VehicleHistoryReportExtract } from '../types';

/**
 * AutoCheck's "Vehicle History at a Glance" HTML has no row-level history
 * table (see parse/autocheck.ts) — only a text-level glance summary plus a
 * per-owner `Owner N Location: ST Owned From: MM/YYYY Usage: word` block.
 * Each owner therefore gets an empty `history_table` (best-effort, per plan).
 */
export function scrapeAutocheckHtml(html: string): VehicleHistoryReportExtract {
  const text = stripAutocheckHtmlToText(html);
  const parsed = parseAutocheckText(text);

  const owners: OwnerHistory[] = parsed.ownershipPeriods.map((p) => ({
    owner_no: p.ownerIndex,
    purchased: p.start,
    type_of_owner: p.usageType,
    millage: null,
    history_table: [],
  }));

  const noAccidents = /No Accidents? or Damage Reported/i.test(text);
  const accident = noAccidents ? false : null; // the glance page has no per-event row to confirm a positive accident flag against.

  return {
    millage: parsed.summary.lastOdometer,
    accident,
    title: resolveTitleBrand(parsed.summary.titleBrands, parsed.summary.brandedTitle),
    value: null, // this corpus's AutoCheck glance template never prints a retail dollar figure.
    service_history_record: parsed.summary.serviceRecordCount,
    at_last_open_recall: parsed.summary.openRecallCount,
    last_owner_state: parsed.summary.lastReportedState,
    owners_history: owners,
  };
}

function resolveTitleBrand(titleBrands: string[], brandedTitle: boolean | null): TitleBrand {
  if (titleBrands.includes('SALVAGE') || titleBrands.includes('JUNK')) return 'Salvage Title';
  if (titleBrands.includes('REBUILT')) return 'Rebuilt Title';
  if (brandedTitle === false) return 'Clean Title';
  return null;
}
