import { ParseFn, ParsedVehicleHistory, PARSER_VERSION, SectionStatus } from './parsed-report.types';
import { detectTemplate } from './detect-template';
import { parseCarfaxHtml } from './carfax-html';
import { extractPdfText, parseCarfaxPdfText } from './carfax-pdf';
import { parseAutocheckText, stripAutocheckHtmlToText } from './autocheck';
import { resolveSectionWithLlm, LlmSection } from './llm-fallback';

const EXPECTED_SECTIONS = ['summary', 'odometerReadings', 'damageEvents', 'titleEvents', 'ownershipPeriods'] as const;
const LLM_SECTIONS: LlmSection[] = ['odometerReadings', 'damageEvents', 'titleEvents', 'ownershipPeriods'];

function emptySummary(): ParsedVehicleHistory['summary'] {
  return {
    accidentCount: null,
    damageReportCount: null,
    structuralDamage: null,
    airbagDeployed: null,
    titleBrands: [],
    brandedTitle: null,
    totalLoss: null,
    salvage: null,
    flood: null,
    lemon: null,
    ownerCount: null,
    lastOdometer: null,
    lastOdometerDate: null,
    odometerRollbackSuspected: null,
    usageTypes: [],
    serviceRecordCount: null,
    openRecallCount: null,
    lastReportedState: null,
  };
}

function unsupported(vin: string, reportType: 'carfax' | 'autocheck', template: string): ParsedVehicleHistory {
  return {
    vin,
    reportType,
    template,
    status: 'unsupported',
    confidence: 0,
    reportDate: null,
    summary: emptySummary(),
    odometerReadings: [],
    damageEvents: [],
    titleEvents: [],
    ownershipPeriods: [],
    sections: {},
    llmSections: [],
    raw: null,
  };
}

/** Rough text window around a section header — good enough to scope what we send to the LLM without shipping the whole document. */
function sectionWindow(text: string, markers: string[], windowChars = 4000): string {
  for (const marker of markers) {
    const idx = text.indexOf(marker);
    if (idx !== -1) return text.slice(idx, idx + windowChars);
  }
  return text.slice(0, windowChars);
}

const SECTION_MARKERS: Record<LlmSection, string[]> = {
  odometerReadings: ['Detailed History', 'Detailed Vehicle History'],
  damageEvents: ['Accident / Damage History', 'Accident & Damage', 'Accident / Damage'],
  titleEvents: ['Title History', 'State Title Brand'],
  ownershipPeriods: ['Ownership History', 'Owner 1'],
};

export const parseVehicleHistory: ParseFn = async (input) => {
  const vin = input.vin ?? '';
  const reportType: 'carfax' | 'autocheck' = input.reportType === 'autocheck' ? 'autocheck' : 'carfax';
  const isPdf = input.contentType === 'application/pdf' || input.body.subarray(0, 5).toString('latin1') === '%PDF-';

  let rawText: string;
  try {
    rawText = isPdf ? await extractPdfText(input.body) : input.body.toString('utf-8');
  } catch {
    return { ...unsupported(vin, reportType, 'unknown'), status: 'failed' };
  }

  if (isPdf && rawText.trim().length < 200) {
    // Scanned / image-only PDF — no extractable text, nothing to parse.
    return unsupported(vin, reportType, 'unknown');
  }

  const template = detectTemplate(rawText, isPdf ? 'pdf' : 'html', reportType);

  if (template === 'unknown') {
    return unsupported(vin, reportType, 'unknown');
  }

  let built: Pick<
    ParsedVehicleHistory,
    'summary' | 'odometerReadings' | 'damageEvents' | 'titleEvents' | 'ownershipPeriods' | 'reportDate'
  > & { sections: Record<string, 'parsed' | 'missing'> };
  // `plainText` is ALWAYS tag-stripped plain text (never raw HTML) — it's
  // what gets windowed and sent to the LLM fallback, so it must never carry
  // markup or structured dealer/address fragments that tag-stripping alone
  // wouldn't catch.
  let plainText: string;

  try {
    if (template === 'carfax-html') {
      const html = input.body.toString('utf-8');
      built = parseCarfaxHtml(html);
      plainText = stripAutocheckHtmlToText(html);
    } else if (template === 'carfax-pdf') {
      plainText = rawText;
      built = parseCarfaxPdfText(rawText);
    } else if (template === 'autocheck-html') {
      plainText = stripAutocheckHtmlToText(input.body.toString('utf-8'));
      built = parseAutocheckText(plainText);
    } else {
      plainText = rawText;
      built = parseAutocheckText(rawText);
    }
  } catch {
    return { ...unsupported(vin, reportType, template), status: 'failed' };
  }

  const sections: Record<string, SectionStatus> = {};
  for (const key of EXPECTED_SECTIONS) {
    sections[key] = built.sections[key] === 'parsed' ? 'parsed' : 'missing';
  }

  const llmSections: string[] = [];
  const llmEligible = LLM_SECTIONS.filter((s) => sections[s] === 'missing');
  for (const section of llmEligible) {
    const windowText = sectionWindow(plainText, SECTION_MARKERS[section]);
    if (section === 'odometerReadings') {
      const resolved = await resolveSectionWithLlm<ParsedVehicleHistory['odometerReadings'][number]>(section, windowText);
      if (resolved && resolved.length > 0) {
        built.odometerReadings = resolved;
        sections[section] = 'llm';
        llmSections.push(section);
      }
    } else if (section === 'damageEvents') {
      const resolved = await resolveSectionWithLlm<ParsedVehicleHistory['damageEvents'][number]>(section, windowText);
      if (resolved && resolved.length > 0) {
        built.damageEvents = resolved;
        sections[section] = 'llm';
        llmSections.push(section);
      }
    } else if (section === 'titleEvents') {
      const resolved = await resolveSectionWithLlm<ParsedVehicleHistory['titleEvents'][number]>(section, windowText);
      if (resolved && resolved.length > 0) {
        built.titleEvents = resolved;
        sections[section] = 'llm';
        llmSections.push(section);
      }
    } else {
      const resolved = await resolveSectionWithLlm<ParsedVehicleHistory['ownershipPeriods'][number]>(section, windowText);
      if (resolved && resolved.length > 0) {
        built.ownershipPeriods = resolved;
        sections[section] = 'llm';
        llmSections.push(section);
      }
    }
  }

  const parsedCount = EXPECTED_SECTIONS.filter((k) => sections[k] === 'parsed' || sections[k] === 'llm').length;
  let confidence = parsedCount / EXPECTED_SECTIONS.length;
  confidence -= 0.1 * llmSections.length;
  confidence = Math.max(0, Math.min(1, confidence));

  const missingCount = EXPECTED_SECTIONS.filter((k) => sections[k] === 'missing').length;
  const status: ParsedVehicleHistory['status'] = missingCount === 0 ? 'ok' : 'partial';

  return {
    vin,
    reportType,
    template,
    status,
    confidence,
    reportDate: built.reportDate,
    summary: built.summary,
    odometerReadings: built.odometerReadings,
    damageEvents: built.damageEvents,
    titleEvents: built.titleEvents,
    ownershipPeriods: built.ownershipPeriods,
    sections,
    llmSections,
    raw: {
      template,
      parserVersion: PARSER_VERSION,
      sectionsFound: EXPECTED_SECTIONS.filter((k) => sections[k] !== 'missing'),
      counts: {
        odometerRows: built.odometerReadings.length,
        damageRows: built.damageEvents.length,
        titleRows: built.titleEvents.length,
        owners: built.ownershipPeriods.length,
      },
      textLength: plainText.length,
    },
  };
};

export { PARSER_VERSION };
