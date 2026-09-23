import type { SocialPostTarget } from '@prisma/client';
import { sumEngagements, type PostMetricsResult } from '@htownautos/social';

/** `target.metrics` is a nullable Json column holding a `PostMetricsResult` — everywhere that reads it goes through here. */
export function metricsOf(target: SocialPostTarget): PostMetricsResult | null {
  return (target.metrics as unknown as PostMetricsResult | null) ?? null;
}

/** likes + comments + shares + saves (CONTRACT.md §3.8's definition of "engagements"), `null` when the target has no metrics yet. */
export function targetEngagements(target: SocialPostTarget): number | null {
  const m = metricsOf(target);
  return sumEngagements(m?.likes ?? null, m?.comments ?? null, m?.shares ?? null, m?.saves ?? null);
}
