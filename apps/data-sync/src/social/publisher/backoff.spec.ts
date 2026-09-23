import { computeRetry, RETRY_BACKOFF_MINUTES } from './backoff';

describe('computeRetry', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');

  it('schedules the 1st retry at 2 minutes', () => {
    const r = computeRetry(0, now);
    expect(r.attempts).toBe(1);
    expect(r.terminal).toBe(false);
    expect(r.nextAttemptAt).toEqual(new Date(now.getTime() + RETRY_BACKOFF_MINUTES[0] * 60_000));
  });

  it('schedules the 2nd retry at 8 minutes', () => {
    const r = computeRetry(1, now);
    expect(r.attempts).toBe(2);
    expect(r.terminal).toBe(false);
    expect(r.nextAttemptAt).toEqual(new Date(now.getTime() + RETRY_BACKOFF_MINUTES[1] * 60_000));
  });

  it('schedules the 3rd retry at 30 minutes', () => {
    const r = computeRetry(2, now);
    expect(r.attempts).toBe(3);
    expect(r.terminal).toBe(false);
    expect(r.nextAttemptAt).toEqual(new Date(now.getTime() + RETRY_BACKOFF_MINUTES[2] * 60_000));
  });

  it('gives up after the 4th failure (all 3 backoff slots used)', () => {
    const r = computeRetry(3, now);
    expect(r.attempts).toBe(4);
    expect(r.terminal).toBe(true);
    expect(r.nextAttemptAt).toBeNull();
  });
});
