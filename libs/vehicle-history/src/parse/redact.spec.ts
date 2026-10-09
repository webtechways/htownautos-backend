import { extractStateAbbr, redactPII, scrubSourceLines } from './redact';

describe('redactPII', () => {
  it('scrubs phones, emails, urls and zip codes', () => {
    const text = 'Call 817-485-0300 or visit normreeveshonda.com, email sales@dealer.com, zip 76180.';
    const redacted = redactPII(text);
    expect(redacted).not.toContain('817-485-0300');
    expect(redacted).not.toContain('normreeveshonda.com');
    expect(redacted).not.toContain('sales@dealer.com');
    expect(redacted).not.toContain('76180');
  });
});

describe('extractStateAbbr', () => {
  it('pulls a 2-letter state code out of a city/state blob', () => {
    expect(extractStateAbbr('North Richland Hills, TX')).toBe('TX');
    expect(extractStateAbbr('LEWISVILLE, TX')).toBe('TX');
  });

  it('resolves a full state name to its abbreviation', () => {
    expect(extractStateAbbr('Last Owned in Texas')).toBe('TX');
  });

  it('returns null when no state is present', () => {
    expect(extractStateAbbr('Some Dealer Name LLC')).toBeNull();
  });

  it('never returns boilerplate glued onto the state name without a space', () => {
    // Regression: cheerio-flattened text sometimes drops the space between
    // adjacent text nodes ("Last Owned in GeorgiaCARFAX Homegrown...").
    expect(extractStateAbbr('GeorgiaCARFAX Homegrown')).toBeNull();
    expect(extractStateAbbr('Georgia')).toBe('GA');
  });
});

describe('scrubSourceLines', () => {
  it('replaces dealer-name lines with a placeholder', () => {
    const text = ['11/16/2016\tLone Star Toyota of Lewisville', 'Lewisville, TX', 'Vehicle serviced'].join('\n');
    const scrubbed = scrubSourceLines(text);
    expect(scrubbed).not.toContain('Lone Star Toyota');
    expect(scrubbed).not.toContain('Lewisville');
    expect(scrubbed).toContain('Vehicle serviced');
  });

  it('keeps report-structure sentences even if they mention a brand word', () => {
    const text = 'Title issued or updated: Vehicle titled as Toyota dealer inventory';
    expect(scrubSourceLines(text)).toContain('Title issued or updated');
  });
});
