import { computeCostUsd } from './pricing';

describe('computeCostUsd', () => {
  it('computes cost for gpt-4o-mini using in/cached/out rates per 1M tokens', () => {
    const cost = computeCostUsd('gpt-4o-mini', { promptTokens: 1_000_000, cachedTokens: 0, completionTokens: 1_000_000 });
    expect(cost).toBeCloseTo(0.15 + 0.6, 6);
  });

  it('discounts cached tokens at the cached rate', () => {
    const cost = computeCostUsd('gpt-4o-mini', { promptTokens: 1_000_000, cachedTokens: 1_000_000, completionTokens: 0 });
    expect(cost).toBeCloseTo(0.075, 6);
  });

  it('returns null for an unknown model', () => {
    expect(computeCostUsd('not-a-real-model', { promptTokens: 100, cachedTokens: 0, completionTokens: 100 })).toBeNull();
  });

  it('matches the documented ~$0.004/report order of magnitude for a typical report', () => {
    // ~4k input tokens (half cached on a 2nd+ call), ~1k output.
    const cost = computeCostUsd('gpt-4o-mini', { promptTokens: 4000, cachedTokens: 2000, completionTokens: 1000 });
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(0.01);
  });
});
