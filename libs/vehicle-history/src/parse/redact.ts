/**
 * Best-effort PII scrubbing for vehicle history reports.
 *
 * Reports from Carfax/AutoCheck embed dealer/service-shop names, street
 * addresses, phone numbers and websites inside every "source" line of the
 * detailed history table. We never copy those raw substrings into the
 * structured `ParsedVehicleHistory` output (parsers only keep a 2-letter
 * state code via `extractStateAbbr`). These helpers additionally scrub any
 * free text before it is persisted in `raw` or sent to the LLM fallback.
 */

const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS',
  'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY',
  'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV',
  'WI', 'WY', 'DC',
]);

const PHONE_RE = /\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g;
const ZIP_RE = /\b\d{5}(-\d{4})?\b/g;
const URL_RE = /\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|biz|info|us)\/?[\w./?=&-]*/gi;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;

/** Strips phones/emails/urls/zips from free text (LLM input, raw snapshots). */
export function redactPII(text: string): string {
  return text.replace(EMAIL_RE, '[REDACTED]').replace(PHONE_RE, '[REDACTED]').replace(URL_RE, '[REDACTED]').replace(ZIP_RE, '[REDACTED]');
}

const DEALER_KEYWORDS_RE =
  /\b(dealer(ship)?|motors?|superstore|automotive|auto group|chevrolet|toyota|honda|ford|nissan|hyundai|kia|jeep|dodge|ram\b|mazda|subaru|volkswagen|bmw|mercedes|audi|lexus|acura|infiniti|buick|gmc|cadillac|chrysler|repair center|service center|collision center|\binc\.?\b|\bllc\b)/i;
const KEEP_KEYWORDS_RE =
  /\b(vehicle|carfax|autocheck|title|report|owner|damage|recall|odometer|warranty|accident|airbag|structural|loss|brand|service record|registration|inspection|lien)\b/i;
const CITY_STATE_LINE_RE = /^[A-Za-z .'-]+,\s*[A-Z]{2}\.?$/;

/**
 * Line-level scrub for text headed to the LLM fallback: drops dealer/shop
 * name lines and bare "City, ST" location lines, replacing them with a
 * coarse placeholder. Carfax boilerplate sentences that happen to contain
 * one of the dealer keywords (rare) are kept when they also contain a
 * report-structure keyword (title/damage/recall/etc).
 */
export function scrubSourceLines(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (CITY_STATE_LINE_RE.test(trimmed)) return '[LOCATION]';
      if (DEALER_KEYWORDS_RE.test(trimmed) && !KEEP_KEYWORDS_RE.test(trimmed)) return '[SOURCE]';
      return line;
    })
    .join('\n');
}

/**
 * Pulls a 2-letter US state abbreviation out of a location/source blob
 * ("North Richland Hills, TX", "LEWISVILLE, TX", "Last Owned in Texas").
 * Returns null when no recognizable state is found — never returns the
 * city/address text itself.
 */
export function extractStateAbbr(text: string | null | undefined): string | null {
  if (!text) return null;
  const abbrMatch = text.match(/\b([A-Z]{2})\b(?!\w)/g);
  if (abbrMatch) {
    for (const candidate of abbrMatch) {
      if (US_STATES.has(candidate)) return candidate;
    }
  }
  const lower = text.toLowerCase();
  for (const [name, abbr] of STATE_NAME_TO_ABBR) {
    if (new RegExp(`\\b${name}\\b`).test(lower)) return abbr;
  }
  return null;
}

/** Alternation of full state names, longest-first, for use in a case-insensitive capturing regex (e.g. `Last Owned in (STATE_NAME_ALTERNATION)`). Never matches arbitrary trailing words. */
export const STATE_NAME_ALTERNATION = (): string =>
  [...STATE_NAME_TO_ABBR.keys()].sort((a, b) => b.length - a.length).join('|');

const STATE_NAME_TO_ABBR = new Map<string, string>([
  ['alabama', 'AL'], ['alaska', 'AK'], ['arizona', 'AZ'], ['arkansas', 'AR'], ['california', 'CA'],
  ['colorado', 'CO'], ['connecticut', 'CT'], ['delaware', 'DE'], ['florida', 'FL'], ['georgia', 'GA'],
  ['hawaii', 'HI'], ['idaho', 'ID'], ['illinois', 'IL'], ['indiana', 'IN'], ['iowa', 'IA'],
  ['kansas', 'KS'], ['kentucky', 'KY'], ['louisiana', 'LA'], ['maine', 'ME'], ['maryland', 'MD'],
  ['massachusetts', 'MA'], ['michigan', 'MI'], ['minnesota', 'MN'], ['mississippi', 'MS'],
  ['missouri', 'MO'], ['montana', 'MT'], ['nebraska', 'NE'], ['nevada', 'NV'], ['new hampshire', 'NH'],
  ['new jersey', 'NJ'], ['new mexico', 'NM'], ['new york', 'NY'], ['north carolina', 'NC'],
  ['north dakota', 'ND'], ['ohio', 'OH'], ['oklahoma', 'OK'], ['oregon', 'OR'], ['pennsylvania', 'PA'],
  ['rhode island', 'RI'], ['south carolina', 'SC'], ['south dakota', 'SD'], ['tennessee', 'TN'],
  ['texas', 'TX'], ['utah', 'UT'], ['vermont', 'VT'], ['virginia', 'VA'], ['washington', 'WA'],
  ['west virginia', 'WV'], ['wisconsin', 'WI'], ['wyoming', 'WY'],
]);
