import * as cheerio from 'cheerio';
import { extractCarfaxSignals, cleanComment, normalizeDate, parseOdometer } from '../../parse/carfax-common';
import { extractStateAbbr, STATE_NAME_ALTERNATION } from '../../parse/redact';
import { HistoryTableRow, OwnerHistory, TitleBrand, VehicleHistoryReportExtract } from '../types';
import {
  severityClassToDamageType,
  severityTextToDamageType,
  poiClassesToDamageAreas,
  textToDamageAreas,
  isFlooded,
  isBurn,
  isVandalism,
  isTheft,
  isTotalLoss,
  isSalvageIssue,
} from './keywords';

/** Official Carfax HTML template (`detailed-history-row`, `ownership-label`, `common-section-row-heading` — see parse/detect-template.ts). */
export function scrapeCarfaxHtml(html: string): VehicleHistoryReportExtract {
  const $ = cheerio.load(html);
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const signals = extractCarfaxSignals(bodyText);

  const owners: OwnerHistory[] = [];
  let currentOwner: OwnerHistory | null = null;
  let currentRow: HistoryTableRow | null = null;
  let anyAccidentRecord = false;

  $('.ownership-label, .detailed-history-row-main, .detailed-history-row-supplementary').each((_, el) => {
    const $el = $(el);

    if ($el.hasClass('ownership-label')) {
      const label = $el.text().trim(); // "Owner N" or "Owners N-M" — use the first number either way.
      const numMatch = label.match(/(\d+)/);
      const ownerNo = numMatch ? parseInt(numMatch[1], 10) : owners.length + 1;
      const $wrapper = $el.closest('div').parent();
      const purchaseYear = $wrapper.find('.purchase-year').first().text().replace(/Purchased:/i, '').trim();
      const purchased = purchaseYear ? normalizeYearToDate(purchaseYear) : null;
      const ownerTypeText = $wrapper.find('.owner-type').first().text().trim();
      currentOwner = {
        owner_no: ownerNo,
        purchased,
        type_of_owner: ownerTypeText || null,
        millage: null,
        history_table: [],
      };
      owners.push(currentOwner);
      currentRow = null;
      return;
    }

    if (!currentOwner) return; // malformed/unexpected markup — skip rather than misattribute.

    if ($el.hasClass('detailed-history-row-supplementary')) {
      // Damage-detail panel for the *previous* main row (currentRow).
      if (!currentRow) return;
      const severitySlug =
        $el
          .find('.severity-scale')
          .first()
          .attr('class')
          ?.split(/\s+/)
          .find((c) => c !== 'severity-scale' && c.endsWith('-damage')) ?? null;
      const poiClass = $el.find('.poi-image').first().attr('class') ?? null;
      const areas = poiClassesToDamageAreas(poiClass);
      if (severitySlug) currentRow.damage_type = severityClassToDamageType(severitySlug);
      if (areas.length > 0) currentRow.if_damage = areas;
      return;
    }

    // detailed-history-row-main
    const dateText = $el.find('td.record-normal-first-column').clone().children().remove().end().text().trim();
    const date = normalizeDate(dateText);
    const odoText = $el.find('td.record-odometer-reading').first().text().trim();
    const miles = parseOdometer(odoText);
    const sourceLines = $el
      .find('td.record-source p.detail-record-source-line')
      .map((__, p) => $(p).text().trim())
      .get()
      .filter(Boolean);
    const commentGroups = $el
      .find('td.record-comments li.record-comments-group')
      .map((__, group) => {
        const $group = $(group);
        const outer = $group.find('> strong.comments-group-outer-line').first().text().trim();
        const inner = $group
          .find('li.record-comments-group-inner-line')
          .map((___, li) => $(li).text().trim())
          .get()
          .filter(Boolean);
        return [outer, ...inner].filter(Boolean).join('\n');
      })
      .get()
      .filter(Boolean);
    const comment = insertConcatenatedPhraseSpaces(cleanComment(commentGroups.join('\n')));
    const state = extractStateAbbr(sourceLines.join(' '));
    const source = sourceLines[0] ?? (state ? state : null);

    // Only treat this as a damage/accident record when the comment actually
    // says so — "front brake pads replaced" (a service row) must not get a
    // damage_type/if_damage just because `textToDamageAreas` matches "front".
    // "Vehicle Reported as Total Loss" / "Air Bag Deployed" rows are accident
    // events too even though they never say "damage"/"accident"/"collision".
    const isDamageRecord = /damage|accident|collision|total loss|air ?bag deployed/i.test(comment);
    if (isDamageRecord) anyAccidentRecord = true;
    const damageAreas = isDamageRecord ? textToDamageAreas(comment) : [];

    const row: HistoryTableRow = {
      date,
      millage: miles,
      source,
      comment,
      damage_type: isDamageRecord ? severityTextToDamageType(comment) : null,
      if_damage: damageAreas.length > 0 ? damageAreas : null,
      flooded: isFlooded(comment),
      burn: isBurn(comment),
      bandalist: isVandalism(comment),
      teaft: isTheft(comment),
      total_lost: isTotalLoss(comment),
      salvage_issue: isSalvageIssue(comment),
    };
    currentOwner.history_table.push(row);
    currentRow = row;
    if (currentOwner.millage === null && miles !== null) currentOwner.millage = miles;
  });

  // Last odometer reading across the whole report (not any one owner's) — same definition the OpenAI prompt uses for `millage`.
  let millage: number | null = null;
  let lastDate: string | null = null;
  for (const owner of owners) {
    for (const row of owner.history_table) {
      if (row.millage === null) continue;
      if (lastDate === null || (row.date ?? '') >= lastDate) {
        millage = row.millage;
        lastDate = row.date ?? lastDate;
      }
    }
  }

  // Any row whose comment reads as an accident/damage/total-loss/airbag event
  // counts, even when Carfax didn't attach a severity-scale/poi-image detail
  // panel to it (e.g. plain "Accident reported", "Vehicle Reported as Total
  // Loss") — plus the document-level summary signals for the same thing.
  const accidentSignal =
    anyAccidentRecord || signals.totalLoss === true || signals.structuralDamage === true || signals.airbagDeployed === true;
  const noAccidentPhrase = /no accidents?\b[^.]{0,40}?reported/i.test(bodyText);
  const accident = accidentSignal ? true : noAccidentPhrase ? false : null;

  const brandEvents = collectTitleBrandEvents(owners);

  return {
    millage,
    accident,
    title: resolveTitleBrand(bodyText, signals.titleBrands ?? [], signals.brandedTitle ?? null, brandEvents),
    value: extractRetailValue(bodyText),
    service_history_record: signals.serviceRecordCount ?? null,
    at_last_open_recall: signals.openRecallCount ?? null,
    last_owner_state: extractStateAbbr(signals.lastReportedState) ?? extractLastOwnerStateFallback(bodyText) ?? null,
    owners_history: owners,
  };
}

/**
 * Carfax renders several badge-like phrases inline with no actual whitespace
 * between them when they come from separate elements with no text-node gap
 * (observed: "reportedSALVAGE TITLE/CERTIFICATE ISSUED", "VEHICLEVehicle
 * declared a total loss...companyFire damage reported") — our `\b`-anchored
 * keyword regexes (keywords.ts, collectTitleBrandEvents) need a real word
 * boundary there. Heuristic: insert a space at a lower/digit→upper transition,
 * and at an UPPER→Upper+lower transition (the end of an ALL-CAPS run bleeding
 * into a Title-Case word) — the only two concatenation shapes seen in this
 * corpus.
 */
function insertConcatenatedPhraseSpaces(text: string): string {
  return text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
}

function normalizeYearToDate(raw: string): string | null {
  const yearMatch = raw.match(/(\d{4})/);
  return yearMatch ? `${yearMatch[1]}-01-01` : null;
}

/**
 * `extractCarfaxSignals`'s "Last Owned in STATE" regex only matches a phrasing
 * this corpus's "Owner History" summary table doesn't actually use — its real
 * phrasing is "Owned in the following states/provinces" immediately followed
 * by one state name per owner column (no separator), ending right before
 * "Estimated miles driven per year". The LAST state name in that run is the
 * most recent owner's.
 */
function extractLastOwnerStateFallback(text: string): string | null {
  const m = text.match(new RegExp(`states/provinces((?:${STATE_NAME_ALTERNATION()})+)Estimated miles`, 'i'));
  if (!m) return null;
  const names = m[1].match(new RegExp(STATE_NAME_ALTERNATION(), 'gi'));
  if (!names || names.length === 0) return null;
  return extractStateAbbr(names[names.length - 1]);
}

function extractRetailValue(text: string): number | null {
  const m = text.match(/(?:carfax value|History-Based Value)\$?\s*([\d,]+)/i);
  return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
}

interface TitleBrandEvent {
  date: string | null;
  brand: Exclude<TitleBrand, null>;
}

/** Fixed severity order used only as a tie-breaker among undated brand events (never between dated ones — the most recent *dated* brand always wins, see resolveTitleBrand). */
const BRAND_PRIORITY: Record<Exclude<TitleBrand, null>, number> = {
  'Non Reparable': 3,
  'Salvage Title': 2,
  'Rebuilt Title': 1,
  'Clean Title': 0,
};

/**
 * Title brands change over a vehicle's life (salvage -> rebuilt is the
 * canonical case, e.g. carfax__57009906-*: SALVAGE TITLE/CERTIFICATE ISSUED
 * 2025-11-21, then REBUILT TITLE ISSUED 2026-01-22 — current status is
 * Rebuilt). Each detailed-history row that names a title-brand event is a
 * point-in-time fact, dated by that row's own date field.
 */
function collectTitleBrandEvents(owners: OwnerHistory[]): TitleBrandEvent[] {
  const events: TitleBrandEvent[] = [];
  for (const owner of owners) {
    for (const row of owner.history_table) {
      const c = row.comment;
      if (!/title/i.test(c)) continue;
      let brand: Exclude<TitleBrand, null> | null = null;
      if (/non-?repairable|not economically repairable|dismantled/i.test(c)) brand = 'Non Reparable';
      else if (/\bjunk\b/i.test(c)) brand = 'Non Reparable';
      else if (/\bsalvage\b/i.test(c)) brand = 'Salvage Title';
      else if (/\brebuilt\b/i.test(c)) brand = 'Rebuilt Title';
      else if (/\bclean title\b/i.test(c)) brand = 'Clean Title';
      if (brand) events.push({ date: row.date, brand });
    }
  }
  return events;
}

function resolveTitleBrand(
  text: string,
  titleBrands: string[],
  brandedTitle: boolean | null,
  brandEvents: TitleBrandEvent[],
): TitleBrand {
  if (brandEvents.length > 0) {
    const dated = brandEvents.filter((e) => e.date !== null);
    if (dated.length > 0) {
      // Most recent dated event wins — a later brand supersedes an earlier one.
      dated.sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0));
      return dated[dated.length - 1].brand;
    }
    // No row carried a date — fall back to fixed severity priority among the undated events.
    return brandEvents.reduce((worst, e) => (BRAND_PRIORITY[e.brand] > BRAND_PRIORITY[worst.brand] ? e : worst)).brand;
  }

  // No row-level title-brand event found — fall back to the document-level
  // "Damage Brands" legend signals (see parse/carfax-common.ts).
  const hasNonRepairable = /non-?repairable|not economically repairable/i.test(text);
  if (hasNonRepairable && (titleBrands.includes('SALVAGE') || titleBrands.includes('JUNK'))) return 'Non Reparable';
  if (titleBrands.includes('SALVAGE') || titleBrands.includes('JUNK')) return 'Salvage Title';
  if (titleBrands.includes('REBUILT')) return 'Rebuilt Title';
  if (brandedTitle === false) return 'Clean Title';
  // "Problem Found" fired (a brand category was flagged by a state DMV) but the
  // specific word never appears outside the fixed legend line — same "rare
  // code defaults to the conservative category" convention used for the
  // Copart/IAAI title-category mapping: default to Salvage Title rather than null.
  if (brandedTitle === true) return 'Salvage Title';
  return null;
}
