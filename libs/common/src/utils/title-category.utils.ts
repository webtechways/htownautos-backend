/**
 * Title-type categorization — single source of truth for the whole backend.
 *
 * Auction `saleTitleType` comes straight from Copart's feed as a 2-letter code
 * (ct, st, sc, nr, cd, po, bs…). The business collapses the codes into the
 * primary buckets used everywhere cars are listed:
 *
 *   - clean          → Clean Title
 *   - rebuilt        → Rebuilt Title (previously salvage, repaired + retitled)
 *   - salvage        → Salvage Title
 *   - nonrepairable  → Non-repairable / Parts Only / Certificate of Destruction
 *   - unknown        → a code we don't recognise yet (staff classify it from the
 *                      listing UI; the assignment is persisted in the
 *                      auction_title_type_mappings table and applied to every
 *                      lot with that code from then on)
 *
 * Base codes below are the ones the team had labels for. Anything else is
 * `unknown` until a staff mapping (the `overrides` argument) says otherwise.
 * We never silently guess an unknown code as clean/salvage — that would risk
 * showing a salvage as Clean.
 */

export type TitleCategory = 'clean' | 'rebuilt' | 'salvage' | 'nonrepairable' | 'unknown';

/** Assignable categories a staff member can pick for an unknown code. */
export const ASSIGNABLE_TITLE_CATEGORIES: Exclude<TitleCategory, 'unknown'>[] = [
  'clean',
  'rebuilt',
  'salvage',
  'nonrepairable',
];

/** All categories the filter UI surfaces (unknown last). */
export const TITLE_CATEGORIES: TitleCategory[] = [
  ...ASSIGNABLE_TITLE_CATEGORIES,
  'unknown',
];

export const TITLE_CATEGORY_LABELS: Record<TitleCategory, string> = {
  clean: 'Clean Title',
  rebuilt: 'Rebuilt Title',
  salvage: 'Salvage Title',
  nonrepairable: 'Non-repairable',
  unknown: 'Unknown',
};

/** Base (hardcoded) Copart 2-letter codes grouped by category. */
export const TITLE_CATEGORY_CODES: Record<
  Exclude<TitleCategory, 'unknown'>,
  string[]
> = {
  clean: ['ct', 'cz', 'fs'],
  rebuilt: ['rb'],
  nonrepairable: ['nr', 'cd', 'po', 'nu', 'sr', 'bp'],
  salvage: [
    'st',
    'sc',
    'sv',
    's1',
    'sd',
    'ps',
    'dv',
    'rs',
    'sm',
    'ls',
    'bs',
  ],
};

/** A learned code→category map (from the DB), keyed by lowercased code. */
export type TitleOverrides = Record<string, Exclude<TitleCategory, 'unknown'>>;

// base code → category reverse lookup, built once.
const BASE_CODE_TO_CATEGORY: Record<string, Exclude<TitleCategory, 'unknown'>> =
  (() => {
    const map: Record<string, Exclude<TitleCategory, 'unknown'>> = {};
    for (const cat of ASSIGNABLE_TITLE_CATEGORIES) {
      for (const code of TITLE_CATEGORY_CODES[cat]) map[code] = cat;
    }
    return map;
  })();

/**
 * Derive the primary title category from a raw `saleTitleType` value.
 * Resolution order: staff override → base code → rebuilt/clean/nonrepairable
 * text signals → `unknown`. (No salvage-by-default: unmapped codes surface as
 * unknown so staff can classify them.)
 */
export function deriveTitleCategory(
  raw?: string | null,
  overrides?: TitleOverrides,
): TitleCategory {
  if (!raw) return 'unknown';
  const v = raw.toLowerCase().trim();

  if (overrides && overrides[v]) return overrides[v];

  const byCode = BASE_CODE_TO_CATEGORY[v];
  if (byCode) return byCode;

  // full-text signals (feed sometimes carries labels instead of codes)
  if (v.includes('rebuilt') || v.includes('rebuild') || v.includes('reconstruct')) {
    return 'rebuilt';
  }
  if (v.includes('clean') || v.includes('clear')) return 'clean';
  if (
    v.includes('non-repair') ||
    v.includes('nonrepair') ||
    v.includes('non repair') ||
    v.includes('parts only') ||
    v.includes('part only') ||
    v.includes('destruction') ||
    v.includes('junk')
  ) {
    return 'nonrepairable';
  }
  return 'unknown';
}

/**
 * The flat list of raw codes that map to the given non-unknown categories,
 * combining the base codes with any staff overrides. Used to translate a
 * selected category into a `terms` / `IN` filter on `saleTitleType`.
 */
export function codesForTitleCategories(
  categories: string[],
  overrides?: TitleOverrides,
): string[] {
  const wanted = new Set(categories);
  const out = new Set<string>();
  for (const cat of ASSIGNABLE_TITLE_CATEGORIES) {
    if (wanted.has(cat)) for (const c of TITLE_CATEGORY_CODES[cat]) out.add(c);
  }
  if (overrides) {
    for (const [code, cat] of Object.entries(overrides)) {
      if (wanted.has(cat)) out.add(code);
    }
  }
  return [...out];
}

/**
 * Every code that resolves to a known (non-unknown) category. A lot whose code
 * is NOT in this set is `unknown` — used to build the "unknown" filter as a
 * negation (NOT IN allKnownCodes).
 */
export function allKnownCodes(overrides?: TitleOverrides): string[] {
  const out = new Set<string>(Object.keys(BASE_CODE_TO_CATEGORY));
  if (overrides) for (const code of Object.keys(overrides)) out.add(code);
  return [...out];
}

/**
 * The fully-resolved code→category map: base codes merged with staff
 * overrides (overrides win), keyed by lowercased code. This is what a
 * consumer needs to translate any raw `saleTitleType` value without calling
 * back into this module — e.g. the public `/auctions/title-mappings/resolved`
 * endpoint.
 */
export function resolveTitleCodeMap(
  overrides?: TitleOverrides,
): Record<string, Exclude<TitleCategory, 'unknown'>> {
  const map: Record<string, Exclude<TitleCategory, 'unknown'>> = {
    ...BASE_CODE_TO_CATEGORY,
  };
  if (overrides) {
    for (const [code, cat] of Object.entries(overrides)) {
      map[code.toLowerCase()] = cat;
    }
  }
  return map;
}
