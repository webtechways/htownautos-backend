/**
 * USD cost of a single extraction call from token usage. Rates are per 1M
 * tokens; override via `VH_EXTRACT_PRICING_JSON` (same shape as
 * DEFAULT_PRICING) without a redeploy if OpenAI changes prices.
 */
export interface ModelPricing {
  in: number;
  cached: number;
  out: number;
}

export const DEFAULT_PRICING: Record<string, ModelPricing> = {
  'gpt-4o-mini': { in: 0.15, cached: 0.075, out: 0.6 },
  'gpt-4o': { in: 2.5, cached: 1.25, out: 10 },
  'gpt-4.1-mini': { in: 0.4, cached: 0.1, out: 1.6 },
  'gpt-4.1': { in: 2, cached: 0.5, out: 8 },
  // Current flagship reasoning model (2026-10) — "reasoning" (hidden
  // chain-of-thought) tokens bill as output tokens, so a report with a long
  // owners_history table costs noticeably more than gpt-4o-mini. Confirmed
  // via OpenAI docs (developers.openai.com/api/docs/models/gpt-6-astra).
  'gpt-6-astra': { in: 10, cached: 1, out: 50 },
};

let cachedOverride: Record<string, ModelPricing> | null | undefined;

function getPricingTable(): Record<string, ModelPricing> {
  if (cachedOverride !== undefined) return { ...DEFAULT_PRICING, ...(cachedOverride ?? {}) };
  const raw = process.env.VH_EXTRACT_PRICING_JSON;
  if (!raw) {
    cachedOverride = null;
    return DEFAULT_PRICING;
  }
  try {
    cachedOverride = JSON.parse(raw) as Record<string, ModelPricing>;
  } catch {
    cachedOverride = null;
  }
  return { ...DEFAULT_PRICING, ...(cachedOverride ?? {}) };
}

export interface TokenUsage {
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
}

/** Returns null (never throws) for an unknown model — caller logs cost as null and warns. */
export function computeCostUsd(model: string, usage: TokenUsage): number | null {
  const pricing = getPricingTable()[model];
  if (!pricing) return null;
  const uncachedIn = Math.max(0, usage.promptTokens - usage.cachedTokens);
  const cost =
    (uncachedIn * pricing.in + usage.cachedTokens * pricing.cached + usage.completionTokens * pricing.out) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
