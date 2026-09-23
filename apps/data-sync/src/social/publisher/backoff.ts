/**
 * Retry backoff for transient publish failures (CONTRACT.md §4: "max 3
 * attempts with backoff for transient errors (network/5xx/429)").
 *
 * Interpretation (all three backoff values are used, per the brief listing
 * three numbers): `attemptsBefore` is the target's current `attempts`
 * column. Each transient failure increments it; the Nth failure (N = new
 * attempts count) waits `RETRY_BACKOFF_MINUTES[N-1]`. Once the count would
 * exceed the backoff table (the 4th failure), there is no more retrying —
 * the target is marked `failed`.
 */
export const RETRY_BACKOFF_MINUTES = [2, 8, 30] as const;

export interface RetryDecision {
  attempts: number;
  nextAttemptAt: Date | null;
  terminal: boolean;
}

export function computeRetry(attemptsBefore: number, now: Date = new Date()): RetryDecision {
  const attempts = attemptsBefore + 1;
  if (attempts > RETRY_BACKOFF_MINUTES.length) {
    return { attempts, nextAttemptAt: null, terminal: true };
  }
  const minutes = RETRY_BACKOFF_MINUTES[attempts - 1];
  return { attempts, nextAttemptAt: new Date(now.getTime() + minutes * 60_000), terminal: false };
}
