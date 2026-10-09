import { readFileSync } from 'fs';
import { join } from 'path';
import { parseAutocheckText, stripAutocheckHtmlToText } from './autocheck';

const textFixture = readFileSync(join(__dirname, '__fixtures__/autocheck.fixture.txt'), 'utf-8');
const htmlFixture = readFileSync(join(__dirname, '__fixtures__/autocheck-html.fixture.html'), 'utf-8');

describe('parseAutocheckText', () => {
  it('extracts the glance-level summary from the AutoCheck PDF text layout', () => {
    const result = parseAutocheckText(textFixture);

    expect(result.summary.brandedTitle).toBe(false);
    expect(result.summary.accidentCount).toBe(0);
    expect(result.summary.openRecallCount).toBe(0);
    expect(result.summary.serviceRecordCount).toBe(117);
    expect(result.summary.lastOdometer).toBe(227356);
    expect(result.summary.lastOdometerDate).toBe('2026-07-27');
    expect(result.ownershipPeriods[0]).toMatchObject({ ownerIndex: 1, state: 'TX', usageType: 'personal' });
  });

  it('parses the same glance summary once the HTML template has been stripped to text', () => {
    const stripped = stripAutocheckHtmlToText(htmlFixture);
    const result = parseAutocheckText(stripped);

    expect(result.summary.brandedTitle).toBe(false);
    expect(result.summary.serviceRecordCount).toBe(117);
  });
});
