import { detectTemplate } from '../../parse/detect-template';
import { normalizeReportDates } from '../normalize-dates';
import { VehicleHistoryReportExtract } from '../types';
import { scrapeCarfaxHtml } from './carfax-html';
import { scrapeAutocheckHtml } from './autocheck-html';

export interface ScrapeInput {
  body: Buffer;
  contentType: string;
  vin: string | null;
}

export interface ScrapeResult {
  report: VehicleHistoryReportExtract | null;
  isReport: boolean;
  template: string;
  warnings: string[];
}

function emptyReport(): VehicleHistoryReportExtract {
  return {
    millage: null,
    accident: null,
    title: null,
    value: null,
    service_history_record: null,
    at_last_open_recall: null,
    last_owner_state: null,
    owners_history: [],
  };
}

/** Deterministic cheerio-based replacement for the OpenAI extraction path — see extract/scrape/*.ts. PDFs are explicitly out of scope (see plan Task A). */
export function scrapeReport(input: ScrapeInput): ScrapeResult {
  const { body, contentType } = input;

  if (contentType === 'application/pdf') {
    return { report: null, isReport: false, template: 'pdf', warnings: ['pdf_not_supported'] };
  }

  const html = body.toString('utf-8');
  const template = detectTemplate(html, 'html');

  if (template === 'carfax-html') {
    const report = normalizeReportDates(scrapeCarfaxHtml(html));
    return { report, isReport: true, template, warnings: [] };
  }
  if (template === 'autocheck-html') {
    const report = normalizeReportDates(scrapeAutocheckHtml(html));
    return { report, isReport: true, template, warnings: [] };
  }

  return { report: emptyReport(), isReport: false, template: 'unknown', warnings: ['unrecognized_template'] };
}
