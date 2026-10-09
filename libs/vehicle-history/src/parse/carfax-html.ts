import * as cheerio from 'cheerio';
import { ParsedVehicleHistory } from './parsed-report.types';
import { extractCarfaxSignals, cleanComment, normalizeDate, parseOdometer } from './carfax-common';
import { extractStateAbbr } from './redact';

type BuiltSections = Pick<
  ParsedVehicleHistory,
  'summary' | 'odometerReadings' | 'damageEvents' | 'titleEvents' | 'ownershipPeriods' | 'reportDate'
> & { sections: Record<string, 'parsed' | 'missing'> };

function sourceCategory(lines: string[]): string {
  const joined = lines.join(' ').toLowerCase();
  if (/motor vehicle dept|dmv/.test(joined)) return 'dmv';
  if (/inspection station/.test(joined)) return 'inspection_station';
  if (/manufacturer|nicb|independent source/.test(joined)) return 'manufacturer_or_registry';
  if (/auction/.test(joined)) return 'auction';
  if (/dealer inventory/.test(joined)) return 'dealer';
  if (lines.length > 0) return 'dealer_or_service_shop';
  return 'unknown';
}

/** Parses the official Carfax HTML report (also served verbatim by the cheapcarfax.net reseller). */
export function parseCarfaxHtml(html: string): BuiltSections {
  const $ = cheerio.load(html);
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  const signals = extractCarfaxSignals(text);

  const odometerReadings: BuiltSections['odometerReadings'] = [];
  const damageEvents: BuiltSections['damageEvents'] = [];
  const titleEvents: BuiltSections['titleEvents'] = [];
  const ownershipPeriods: BuiltSections['ownershipPeriods'] = [];

  let ownerIndex = 0;
  let ownerUsage: string | null = null;
  let ownerStart: string | null = null;

  $('.ownership-label, .detailed-history-row-main').each((_, el) => {
    const $el = $(el);
    if ($el.hasClass('ownership-label')) {
      ownerIndex += 1;
      const $wrapper = $el.closest('div').parent();
      const purchaseYear = $wrapper.find('.purchase-year').first().text().replace(/Purchased:/i, '').trim();
      ownerStart = purchaseYear ? `${purchaseYear}-01-01` : null;
      const ownerTypeText = $wrapper.find('.owner-type').first().text().trim();
      ownerUsage = /commercial/i.test(ownerTypeText)
        ? 'commercial'
        : /personal/i.test(ownerTypeText)
          ? 'personal'
          : /fleet/i.test(ownerTypeText)
            ? 'fleet'
            : null;
      const avgMileageText = $wrapper.find('.average-mileage').first().text();
      const milesPerYear = parseOdometer(avgMileageText);
      ownershipPeriods.push({
        ownerIndex,
        start: ownerStart,
        end: null,
        usageType: ownerUsage,
        state: null,
        milesPerYear,
      });
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
    const comments = $el
      .find('td.record-comments li')
      .map((__, li) => $(li).text().trim())
      .get()
      .filter(Boolean);
    const commentsJoined = cleanComment(comments.join(' | '));
    const state = extractStateAbbr(sourceLines.join(' '));
    const category = sourceCategory(sourceLines);

    if (miles !== null) {
      odometerReadings.push({ date, miles, source: category });
    }

    if (/damage reported|damage to |collision/i.test(commentsJoined)) {
      damageEvents.push({
        date,
        kind: 'damage',
        severity: /minor damage/i.test(commentsJoined)
          ? 'minor'
          : /moderate damage/i.test(commentsJoined)
            ? 'moderate'
            : /severe damage/i.test(commentsJoined)
              ? 'severe'
              : null,
        area: null,
        airbag: /airbag/i.test(commentsJoined) ? true : null,
        description: commentsJoined,
      });
    }
    if (/total loss/i.test(commentsJoined)) {
      damageEvents.push({ date, kind: 'total_loss', severity: null, area: null, airbag: null, description: commentsJoined });
    }
    if (/title issued|title number|registration issued|loan or lien reported/i.test(commentsJoined)) {
      const brandMatch = commentsJoined.match(/salvage|junk|rebuilt|fire|flood|hail|lemon/i);
      titleEvents.push({
        date,
        state,
        brand: brandMatch ? brandMatch[0].toUpperCase() : null,
        kind: /title issued/i.test(commentsJoined)
          ? 'title_issued'
          : /registration/i.test(commentsJoined)
            ? 'registration'
            : 'title_record',
        odometer: miles,
      });
    }
  });

  const lastReading = odometerReadings[odometerReadings.length - 1] ?? null;
  const rollbackByData = odometerReadings.some((r, i) => i > 0 && r.miles < odometerReadings[i - 1].miles);

  const sections: Record<string, 'parsed' | 'missing'> = {
    summary: 'parsed',
    odometerReadings: odometerReadings.length > 0 ? 'parsed' : 'missing',
    damageEvents: 'parsed',
    titleEvents: titleEvents.length > 0 ? 'parsed' : 'missing',
    ownershipPeriods: ownershipPeriods.length > 0 ? 'parsed' : 'missing',
  };

  return {
    reportDate: signals.reportDate ?? null,
    summary: {
      accidentCount: damageEvents.filter((e) => e.kind === 'damage').length || null,
      damageReportCount: damageEvents.filter((e) => e.kind === 'damage').length || null,
      structuralDamage: signals.structuralDamage ?? null,
      airbagDeployed: signals.airbagDeployed ?? null,
      titleBrands: signals.titleBrands ?? [],
      brandedTitle: signals.brandedTitle ?? null,
      totalLoss: signals.totalLoss ?? (damageEvents.some((e) => e.kind === 'total_loss') ? true : null),
      salvage: signals.salvage ?? null,
      flood: signals.flood ?? null,
      lemon: signals.lemon ?? null,
      ownerCount: signals.ownerCount ?? (ownerIndex || null),
      lastOdometer: lastReading?.miles ?? null,
      lastOdometerDate: lastReading?.date ?? null,
      odometerRollbackSuspected: signals.odometerRollbackSuspected ?? rollbackByData ?? null,
      usageTypes: signals.usageTypes ?? [],
      serviceRecordCount: signals.serviceRecordCount ?? null,
      openRecallCount: signals.openRecallCount ?? null,
      lastReportedState: extractStateAbbr(signals.lastReportedState) ?? null,
    },
    odometerReadings,
    damageEvents,
    titleEvents,
    ownershipPeriods,
    sections,
  };
}
