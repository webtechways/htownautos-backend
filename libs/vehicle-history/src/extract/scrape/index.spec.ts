import { scrapeReport } from './index';

describe('scrapeReport', () => {
  it('flags PDFs as unsupported without attempting to parse them', () => {
    const res = scrapeReport({ body: Buffer.from('%PDF-1.4 fake'), contentType: 'application/pdf', vin: null });
    expect(res.report).toBeNull();
    expect(res.isReport).toBe(false);
    expect(res.template).toBe('pdf');
    expect(res.warnings).toContain('pdf_not_supported');
  });

  it('dispatches a Carfax HTML template to the carfax scraper', () => {
    const html =
      '<html><body><table><tr class="detailed-history-row-main"><td class="record-normal-first-column">01/01/2021</td><td class="record-odometer-reading">1,000</td><td class="record-source"></td><td class="record-icon"></td><td class="record-comments"></td></tr></table><div class="common-section-row-heading"></div></body></html>';
    const res = scrapeReport({ body: Buffer.from(html), contentType: 'text/html', vin: null });
    expect(res.template).toBe('carfax-html');
    expect(res.isReport).toBe(true);
    expect(res.report).not.toBeNull();
  });

  it('marks an unrecognized document as not a report without throwing', () => {
    const html = '<html><body><p>Not a vehicle history report, just some other page.</p></body></html>';
    const res = scrapeReport({ body: Buffer.from(html), contentType: 'text/html', vin: null });
    expect(res.isReport).toBe(false);
    expect(res.template).toBe('unknown');
    expect(res.report).not.toBeNull(); // empty-but-present report, same contract as the OpenAI path's not_report case.
    expect(res.report?.owners_history).toEqual([]);
  });
});
