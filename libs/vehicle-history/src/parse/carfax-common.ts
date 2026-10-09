import { ParsedVehicleHistory } from './parsed-report.types';
import { redactPII, STATE_NAME_ALTERNATION } from './redact';

export type CarfaxSummary = ParsedVehicleHistory['summary'];

const TITLE_BRAND_WORDS = ['SALVAGE', 'JUNK', 'REBUILT', 'FIRE', 'FLOOD', 'HAIL', 'LEMON'];

/**
 * Text-level signals shared by the Carfax HTML and Carfax PDF templates —
 * both render the same "Additional History" / "Title History" boilerplate
 * phrasing, just with different markup around it. Operates on text that has
 * already had tags stripped (HTML) or been extracted as-is (PDF).
 */
export function extractCarfaxSignals(text: string): Partial<CarfaxSummary> & { reportDate: string | null } {
  const totalLoss = /vehicle declared a total loss|total loss reported:/i.test(text)
    ? true
    : /no total loss reported to carfax/i.test(text)
      ? false
      : null;

  const structuralDamage = /no structural damage reported to carfax/i.test(text)
    ? false
    : /structural damage/i.test(text)
      ? true
      : null;

  const airbagDeployed = /airbag deployment reported:/i.test(text)
    ? true
    : /no airbag deployment reported to carfax/i.test(text)
      ? false
      : null;

  const odometerRollbackFlagged = /odometer rollback indicated|mileage inconsistency|inconsistent mileage indicated/i.test(text)
    ? true
    : /no indication of an odometer rollback/i.test(text)
      ? false
      : null;

  const openRecallMatch = text.match(/At Least (\d+) Open Recall/i);
  const noRecallMatch = /no open recalls reported to carfax/i.test(text);
  const openRecallCount = openRecallMatch ? parseInt(openRecallMatch[1], 10) : noRecallMatch ? 0 : null;

  const serviceRecordMatch = text.match(/(\d+)\s+Service History Records?/i);
  const serviceRecordCount = serviceRecordMatch ? parseInt(serviceRecordMatch[1], 10) : null;

  // Capture only a known state name — never a run of arbitrary words — so a
  // missing space in the source markup (e.g. "GeorgiaCARFAX Homegrown")
  // can't bleed unrelated boilerplate into this field.
  const lastReportedStateMatch = text.match(new RegExp(`Last Owned in (${STATE_NAME_ALTERNATION()})`, 'i'));
  const lastReportedState = lastReportedStateMatch ? lastReportedStateMatch[1].trim() : null;

  const usageTypes: string[] = [];
  if (/personal vehicle/i.test(text)) usageTypes.push('personal');
  if (/commercial vehicle/i.test(text)) usageTypes.push('commercial');
  if (/rental vehicle/i.test(text)) usageTypes.push('rental');
  if (/fleet vehicle/i.test(text)) usageTypes.push('fleet');
  if (/taxi/i.test(text)) usageTypes.push('taxi');
  if (/police|law enforcement/i.test(text)) usageTypes.push('police');
  if (/lease vehicle|leased vehicle/i.test(text)) usageTypes.push('lease');
  if (/government vehicle/i.test(text)) usageTypes.push('government');

  const brandedHeaderMatch = text.match(/branded title ([A-Za-z]+)/i);
  const titleBrandsSet = new Set<string>();
  if (brandedHeaderMatch) {
    const word = brandedHeaderMatch[1].toUpperCase();
    if (TITLE_BRAND_WORDS.includes(word)) titleBrandsSet.add(word);
  }
  // "Problem Found" badges confirm a brand category was flagged; we still
  // rely on keyword hits (title/damage context) to know *which* one.
  const problemFound = /Problem Found/i.test(text);
  if (problemFound) {
    for (const word of TITLE_BRAND_WORDS) {
      const re = new RegExp(`${word}\\s+(title|brand|damage|loss)|${word}\\s*\\|`, 'i');
      if (re.test(text) && new RegExp(word, 'i').test(text)) {
        // Only trust a brand keyword when it appears outside the fixed
        // "Salvage | Junk | Rebuilt | Fire | Flood | Hail | Lemon" legend
        // line that is always present verbatim in every report.
        const legendStripped = text.replace(/Salvage \| Junk \| Rebuilt \| Fire \| Flood \| Hail \| Lemon/gi, '');
        if (new RegExp(word, 'i').test(legendStripped)) titleBrandsSet.add(word);
      }
    }
  }
  const titleBrands = [...titleBrandsSet];
  const brandedTitle = problemFound || titleBrands.length > 0 ? true : /No Problem/i.test(text) ? false : null;

  const ownerMatch = text.match(/(\d+)\s+Previous Owners?/i) ?? text.match(/CARFAX (\d+)-Owner Vehicle/i);
  const ownerCount = ownerMatch
    ? parseInt(ownerMatch[1], 10) + (/CARFAX \d-Owner Vehicle/i.test(text) ? 0 : 1)
    : /CARFAX 1-Owner Vehicle/i.test(text)
      ? 1
      : null;

  const reportDateMatch = text.match(/available as of (\d{1,2}\/\d{1,2}\/\d{2,4}) at ([\d:apmAPM\s]+)\(/);
  const reportDate = reportDateMatch ? normalizeDate(reportDateMatch[1]) : null;

  return {
    totalLoss,
    structuralDamage,
    airbagDeployed,
    odometerRollbackSuspected: odometerRollbackFlagged,
    openRecallCount,
    serviceRecordCount,
    lastReportedState,
    usageTypes,
    titleBrands,
    brandedTitle,
    salvage: titleBrands.includes('SALVAGE') ? true : brandedTitle === false ? false : null,
    flood: titleBrands.includes('FLOOD') ? true : brandedTitle === false ? false : null,
    lemon: titleBrands.includes('LEMON') ? true : brandedTitle === false ? false : null,
    ownerCount,
    reportDate,
  };
}

/** "6/19/26" / "6/19/2026" -> "2026-06-19". Best-effort, returns null on garbage. */
export function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let year = parseInt(m[3], 10);
  if (year < 100) year += year < 50 ? 2000 : 1900;
  const month = m[1].padStart(2, '0');
  const day = m[2].padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseOdometer(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw.replace(/,/g, '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/** Keeps dealer/service-shop comments (carfax boilerplate, no PII) but strips any stray phone/url/email. */
export function cleanComment(text: string): string {
  return redactPII(text.replace(/\s+/g, ' ').trim());
}
