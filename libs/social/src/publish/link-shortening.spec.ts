import { extractUrls, appendUtm } from './link-shortening';

describe('extractUrls', () => {
  it('finds every URL and dedupes repeats', () => {
    const text = 'See https://example.com/a and https://example.com/b, also https://example.com/a again.';
    expect(extractUrls(text)).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('returns an empty array when there is no URL', () => {
    expect(extractUrls('just plain text, no links here')).toEqual([]);
  });

  it('does not swallow trailing punctuation into the URL', () => {
    expect(extractUrls('Check it: https://example.com/deal.')).toEqual(['https://example.com/deal']);
  });
});

describe('appendUtm', () => {
  it('adds utm_source/medium/campaign, defaulting source to the platform', () => {
    const out = appendUtm('https://example.com/x', 'facebook', { utmSource: null, utmMedium: 'social', utmCampaign: 'fall-sale' });
    const u = new URL(out);
    expect(u.searchParams.get('utm_source')).toBe('facebook');
    expect(u.searchParams.get('utm_medium')).toBe('social');
    expect(u.searchParams.get('utm_campaign')).toBe('fall-sale');
  });

  it('prefers an explicit utmSource over the platform default', () => {
    const out = appendUtm('https://example.com/x', 'facebook', { utmSource: 'newsletter', utmMedium: 'social', utmCampaign: null });
    expect(new URL(out).searchParams.get('utm_source')).toBe('newsletter');
  });

  it('leaves a malformed URL untouched instead of throwing', () => {
    expect(appendUtm('not-a-url', 'x', { utmSource: null, utmMedium: 'social', utmCampaign: null })).toBe('not-a-url');
  });
});
