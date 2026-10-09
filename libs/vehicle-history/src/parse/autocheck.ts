import * as cheerio from 'cheerio';
import { ParsedVehicleHistory } from './parsed-report.types';
import { extractStateAbbr } from './redact';
import { normalizeDate, parseOdometer } from './carfax-common';

type BuiltSections = Pick<
  ParsedVehicleHistory,
  'summary' | 'odometerReadings' | 'damageEvents' | 'titleEvents' | 'ownershipPeriods' | 'reportDate'
> & { sections: Record<string, 'parsed' | 'missing'> };

/**
 * Best-effort parser for Experian AutoCheck reports (HTML and PDF share the
 * same "Vehicle History at a Glance" text, just different markup/no markup).
 * AutoCheck doesn't expose a row-level detailed history table the way Carfax
 * does, so only the glance-level summary + owner blocks are structured;
 * everything else is derived from keyword matching ("best-effort" per brief).
 */
export function parseAutocheckText(text: string): BuiltSections {
  const titleBrandMatch = text.match(/State Title Brand\s*\n?\s*(CLEAN|SALVAGE|JUNK|REBUILT|FIRE|FLOOD|HAIL|LEMON)\b/i);
  const titleBrandWord = titleBrandMatch ? titleBrandMatch[1].toUpperCase() : null;
  const brandedTitle = titleBrandWord ? titleBrandWord !== 'CLEAN' : null;
  const titleBrands: string[] = [];
  if (titleBrandWord && titleBrandWord !== 'CLEAN') {
    for (const word of ['SALVAGE', 'JUNK', 'REBUILT', 'FIRE', 'FLOOD', 'HAIL', 'LEMON']) {
      if (titleBrandWord.includes(word)) titleBrands.push(word);
    }
  }

  const noAccidents = /No Accidents? or Damage Reported/i.test(text);
  const accidentIssue = /Accident \/ Damage[\s\S]{0,80}?\bISSUE\b/i.test(text) && !noAccidents;
  const accidentCount = noAccidents ? 0 : accidentIssue ? null : null;

  const recallNoneMatch = /NO OPEN RECALLS|No Open Recalls/i.test(text);
  const recallCountMatch = text.match(/(\d+)\s+Open Recall/i);
  const openRecallCount = recallNoneMatch ? 0 : recallCountMatch ? parseInt(recallCountMatch[1], 10) : null;

  const serviceMatch = text.match(/(\d+)\s+Service Record/i);
  const serviceRecordCount = serviceMatch ? parseInt(serviceMatch[1], 10) : null;

  const odometerMatch = text.match(/Last Reported Odometer:\s*([\d,]+)\s*\(([\d/]+)\)/i);
  const lastOdometer = odometerMatch ? parseOdometer(odometerMatch[1]) : null;
  const lastOdometerDate = odometerMatch ? normalizeDate(odometerMatch[2]) : null;

  const rollbackClean = /Your Vehicle Checks Out[\s\S]{0,200}?odometer/i.test(text) || /no odometer brands, rollbacks/i.test(text);
  const odometerRollbackSuspected = /odometer rollback|mileage discrepanc/i.test(text) && !rollbackClean ? true : rollbackClean ? false : null;

  const structuralDamage = /Structural Damage[\s\S]{0,50}?(Yes|Reported)/i.test(text) ? true : /No Damage|Your Vehicle Checks Out/i.test(text) ? false : null;
  const airbagDeployed = /Airbag Deployed[\s\S]{0,50}?(Yes|Reported)/i.test(text) ? true : /Your Vehicle Checks Out/i.test(text) ? false : null;

  const usageTypes: string[] = [];
  const usageMatch = text.match(/Vehicle Usage\s*\n?\s*(Personal|Commercial|Fleet|Rental|Taxi|Lease|Government)/i);
  if (usageMatch) usageTypes.push(usageMatch[1].toLowerCase());

  const ownershipPeriods: BuiltSections['ownershipPeriods'] = [];
  const ownerRe = /Owner (\d+)\s*Location:\s*([A-Z]{2})\s*Owned From:\s*(\d{2})\/(\d{4})\s*Usage:\s*(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = ownerRe.exec(text))) {
    ownershipPeriods.push({
      ownerIndex: parseInt(m[1], 10),
      start: `${m[4]}-${m[3]}-01`,
      end: null,
      usageType: m[5].toLowerCase(),
      state: m[2],
      milesPerYear: null,
    });
  }

  const lastReportedStateAbbr = ownershipPeriods.length > 0 ? ownershipPeriods[ownershipPeriods.length - 1].state : extractStateAbbr(text.match(/State Title Brand[\s\S]{0,10}/)?.[0] ?? null);

  const sections: Record<string, 'parsed' | 'missing'> = {
    summary: 'parsed',
    odometerReadings: lastOdometer !== null ? 'parsed' : 'missing',
    damageEvents: 'missing', // AutoCheck doesn't expose per-event rows in the glance summary
    titleEvents: titleBrands.length > 0 || titleBrandWord ? 'parsed' : 'missing',
    ownershipPeriods: ownershipPeriods.length > 0 ? 'parsed' : 'missing',
  };

  return {
    reportDate: null,
    summary: {
      accidentCount,
      damageReportCount: accidentCount,
      structuralDamage,
      airbagDeployed,
      titleBrands,
      brandedTitle,
      totalLoss: null,
      salvage: titleBrands.includes('SALVAGE') ? true : brandedTitle === false ? false : null,
      flood: titleBrands.includes('FLOOD') ? true : brandedTitle === false ? false : null,
      lemon: titleBrands.includes('LEMON') ? true : brandedTitle === false ? false : null,
      ownerCount: ownershipPeriods.length || null,
      lastOdometer,
      lastOdometerDate,
      odometerRollbackSuspected,
      usageTypes,
      serviceRecordCount,
      openRecallCount,
      lastReportedState: lastReportedStateAbbr ?? null,
    },
    odometerReadings: lastOdometer !== null ? [{ date: lastOdometerDate, miles: lastOdometer, source: 'autocheck_glance' }] : [],
    damageEvents: [],
    titleEvents: titleBrandWord
      ? [{ date: null, state: lastReportedStateAbbr ?? null, brand: titleBrands[0] ?? null, kind: 'state_title_brand', odometer: null }]
      : [],
    ownershipPeriods,
    sections,
  };
}

export function stripAutocheckHtmlToText(html: string): string {
  // Insert line breaks at block-element boundaries *before* flattening so
  // downstream line-based PII scrubbing (see redact.ts#scrubSourceLines)
  // has something to work with — plain `$('body').text()` would otherwise
  // collapse the whole document into a single line.
  const withBreaks = html.replace(/<\/(p|div|tr|li|h[1-6]|br)>/gi, '\n');
  const $ = cheerio.load(withBreaks);
  $('style, script').remove();
  return $('body')
    .text()
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}
