/**
 * Shared engagement math (CONTRACT.md §3.8: "engagements = likes+comments+shares+saves").
 * Every metrics adapter's `postMetrics` uses these two so the definition of
 * "engagement" is identical across all eleven platforms.
 */

/** Sums the parts that are known; `null` only when every part is `null` (nothing to report, not zero engagement). */
export function sumEngagements(
  likes: number | null,
  comments: number | null,
  shares: number | null,
  saves: number | null,
): number | null {
  const parts = [likes, comments, shares, saves].filter((v): v is number => v != null);
  if (parts.length === 0) return null;
  return parts.reduce((a, b) => a + b, 0);
}

/** `engagements / denominator` (reach, or impressions when reach is unavailable), clamped to 1. `null` without a usable denominator. */
export function engagementRate(engagements: number | null, denominator: number | null): number | null {
  if (engagements == null || !denominator || denominator <= 0) return null;
  return Math.min(1, engagements / denominator);
}
