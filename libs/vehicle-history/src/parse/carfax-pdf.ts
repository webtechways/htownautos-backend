import { PDFParse } from 'pdf-parse';
import { ParsedVehicleHistory } from './parsed-report.types';
import { extractCarfaxSignals, cleanComment, parseOdometer, normalizeDate } from './carfax-common';
import { extractStateAbbr } from './redact';

type BuiltSections = Pick<
  ParsedVehicleHistory,
  'summary' | 'odometerReadings' | 'damageEvents' | 'titleEvents' | 'ownershipPeriods' | 'reportDate'
> & { sections: Record<string, 'parsed' | 'missing'> };

export async function extractPdfText(body: Buffer): Promise<string> {
  const parser = new PDFParse({ data: body });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

function sourceCategory(fragment: string): string {
  const s = fragment.toLowerCase();
  if (/motor vehicle dept|dmv/.test(s)) return 'dmv';
  if (/inspection station/.test(s)) return 'inspection_station';
  if (/manufacturer|nicb|independent source/.test(s)) return 'manufacturer_or_registry';
  if (/auction/.test(s)) return 'auction';
  if (/dealer inventory/.test(s)) return 'dealer';
  if (fragment.trim().length > 0) return 'dealer_or_service_shop';
  return 'unknown';
}

/** Parses the text-based Carfax PDF layout (globalvin provider and manual uploads share this layout). */
export function parseCarfaxPdfText(text: string): BuiltSections {
  const signals = extractCarfaxSignals(text);

  const odometerReadings: BuiltSections['odometerReadings'] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^(\d{2}\/\d{2}\/\d{4})\s*\t([^\t]*)\t?(.*)$/);
    if (!m) continue;
    const date = normalizeDate(m[1]);
    const secondField = m[2].trim();
    const isMileage = /^[\d,]+$/.test(secondField);
    const miles = isMileage ? parseOdometer(secondField) : null;
    const rest = isMileage ? m[3] : `${secondField} ${m[3]}`;
    if (miles !== null) {
      odometerReadings.push({ date, miles, source: sourceCategory(rest) });
    }
  }

  const damageEvents: BuiltSections['damageEvents'] = [];
  const eventRe = /Event \d+\s*\n?\s*(\d{2}\/\d{2}\/\d{4})\s*\n?\s*(Damage reported[^\n]*|TOTAL LOSS VEHICLE[^\n]*)/g;
  let m: RegExpExecArray | null;
  while ((m = eventRe.exec(text))) {
    const date = normalizeDate(m[1]);
    const desc = cleanComment(m[2]);
    const isTotalLoss = /total loss/i.test(desc);
    damageEvents.push({
      date,
      kind: isTotalLoss ? 'total_loss' : 'damage',
      severity: /minor/i.test(desc) ? 'minor' : /moderate/i.test(desc) ? 'moderate' : /severe/i.test(desc) ? 'severe' : null,
      area: null,
      airbag: null,
      description: desc,
    });
  }

  const titleEvents: BuiltSections['titleEvents'] = [];
  const titleLineRe = /(\d{2}\/\d{2}\/\d{4})[^\n]{0,200}(Title Number|Title issued|Title #)[^\n]*/gi;
  while ((m = titleLineRe.exec(text))) {
    const date = normalizeDate(m[1]);
    const context = m[0];
    const brandMatch = context.match(/salvage|junk|rebuilt|fire|flood|hail|lemon/i);
    titleEvents.push({
      date,
      state: extractStateAbbr(context),
      brand: brandMatch ? brandMatch[0].toUpperCase() : null,
      kind: /title issued/i.test(context) ? 'title_issued' : 'title_record',
      odometer: null,
    });
  }

  const ownershipPeriods: BuiltSections['ownershipPeriods'] = [];
  const ownerRe = /Owner (\d+)\s*\n?\s*Purchased:\s*(\d{4})\s*\n?\s*(Personal|Commercial|Fleet)?[^\n]*?([\d,]+)\s*mi\/yr/gi;
  while ((m = ownerRe.exec(text))) {
    ownershipPeriods.push({
      ownerIndex: parseInt(m[1], 10),
      start: `${m[2]}-01-01`,
      end: null,
      usageType: m[3] ? m[3].toLowerCase() : null,
      state: null,
      milesPerYear: parseOdometer(m[4]),
    });
  }

  const lastReading = odometerReadings[odometerReadings.length - 1] ?? null;
  const rollbackByData = odometerReadings.some((r, i) => i > 0 && r.miles < odometerReadings[i - 1].miles);

  const sections: Record<string, 'parsed' | 'missing'> = {
    summary: 'parsed',
    odometerReadings: odometerReadings.length > 0 ? 'parsed' : 'missing',
    damageEvents: damageEvents.length > 0 || signals.accidentCount === 0 ? 'parsed' : 'missing',
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
      ownerCount: signals.ownerCount ?? (ownershipPeriods.length || null),
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
