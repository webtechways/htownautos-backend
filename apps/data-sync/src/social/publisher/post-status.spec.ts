import { recomputePostStatus } from './post-status';

describe('recomputePostStatus', () => {
  it('is publishing when any target is still publishing', () => {
    expect(recomputePostStatus(['published', 'publishing', 'scheduled'])).toBe('publishing');
  });

  it('stays scheduled while anything is still pending (queued/reminder)', () => {
    expect(recomputePostStatus(['published', 'reminder_due'])).toBe('scheduled');
    expect(recomputePostStatus(['scheduled'])).toBe('scheduled');
    expect(recomputePostStatus(['pending_approval'])).toBe('scheduled');
  });

  it('is published when every active target published', () => {
    expect(recomputePostStatus(['published', 'published'])).toBe('published');
  });

  it('ignores cancelled targets', () => {
    expect(recomputePostStatus(['published', 'cancelled'])).toBe('published');
  });

  it('is partial when some published and some failed, nothing pending', () => {
    expect(recomputePostStatus(['published', 'failed'])).toBe('partial');
  });

  it('is failed when every active target failed', () => {
    expect(recomputePostStatus(['failed', 'failed'])).toBe('failed');
  });

  it('is failed when there are no active targets at all', () => {
    expect(recomputePostStatus(['cancelled'])).toBe('failed');
  });
});
