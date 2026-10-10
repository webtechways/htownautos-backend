import { DamageArea, DamageType } from '../types';

/**
 * Deterministic keyword/class rules shared by carfax-html.ts and
 * autocheck-html.ts. Conservative by design: every rule only ever flips a
 * boolean/enum *to* a positive value on an explicit textual or structural
 * match — absence of a match always falls back to the caller's default
 * (usually `false`/`null`), never guessed.
 */

/** Carfax's `severity-scale <slug>-damage` class → our 3-level DamageType. */
export function severityClassToDamageType(slug: string | null | undefined): DamageType {
  if (!slug) return null;
  if (/severe/.test(slug)) return 'heavy';
  if (/moderate/.test(slug)) return 'moderate';
  if (/minor/.test(slug)) return 'minor';
  return null;
}

/** Free-text severity phrasing ("minor damage", "severe damage") → our 3-level DamageType. Used when no severity-scale class is present (e.g. AutoCheck, comment-only rows). */
export function severityTextToDamageType(text: string): DamageType {
  if (/severe damage|major damage/i.test(text)) return 'heavy';
  if (/moderate damage/i.test(text)) return 'moderate';
  if (/minor damage/i.test(text)) return 'minor';
  return null;
}

/** Carfax's `poi-image` diagram class tokens → our DamageArea enum (excludes 'burn', which is never a diagram token — it's inferred from text, see isBurn). */
const POI_CLASS_TO_AREA: Record<string, DamageArea> = {
  front: 'front',
  rear: 'rear',
  'left-side': 'left',
  'right-side': 'right',
  'left-front': 'front_left',
  'right-front': 'front_right',
  'left-rear': 'rear_left',
  'right-rear': 'rear_right',
  roof: 'roof',
};

export function poiClassesToDamageAreas(classAttr: string | null | undefined): DamageArea[] {
  if (!classAttr) return [];
  const areas = new Set<DamageArea>();
  for (const token of classAttr.split(/\s+/)) {
    const area = POI_CLASS_TO_AREA[token];
    if (area) areas.add(area);
  }
  return [...areas];
}

/** Fallback for templates with no diagram (AutoCheck, free-text comments): "damage to front", "left rear", "driver side" phrasing. */
export function textToDamageAreas(text: string): DamageArea[] {
  const areas = new Set<DamageArea>();
  const t = text.toLowerCase();
  if (/front[\s-]?left|left[\s-]?front/.test(t)) areas.add('front_left');
  else if (/front[\s-]?right|right[\s-]?front/.test(t)) areas.add('front_right');
  if (/rear[\s-]?left|left[\s-]?rear/.test(t)) areas.add('rear_left');
  else if (/rear[\s-]?right|right[\s-]?rear/.test(t)) areas.add('rear_right');
  if (/\broof\b/.test(t)) areas.add('roof');
  if (areas.size === 0) {
    if (/\bfront\b/.test(t)) areas.add('front');
    if (/\brear\b|rear[\s-]?end/.test(t)) areas.add('rear');
    if (/driver side|\bleft side\b|\bleft\b/.test(t)) areas.add('left');
    if (/passenger side|\bright side\b|\bright\b/.test(t)) areas.add('right');
  }
  return [...areas];
}

export function isFlooded(text: string): boolean {
  return /\bflood(ed|ing)?\b/i.test(text);
}

export function isBurn(text: string): boolean {
  return /\b(fire|burn(ed|t)?)\b/i.test(text);
}

export function isVandalism(text: string): boolean {
  return /\bvandal(ism|ized)?\b/i.test(text);
}

export function isTheft(text: string): boolean {
  return /\b(stolen|theft)\b/i.test(text);
}

export function isTotalLoss(text: string): boolean {
  return /total loss/i.test(text);
}

export function isSalvageIssue(text: string): boolean {
  return /\bsalvage\b|\bjunk\b|non-?repairable|not economically repairable/i.test(text);
}
