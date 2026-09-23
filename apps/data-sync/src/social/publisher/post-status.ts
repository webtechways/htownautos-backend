/**
 * Recomputes a `SocialPost.status` from its targets' statuses (CONTRACT.md
 * §4: "recompute post status"). Pure so it can be unit-tested without a DB.
 *
 * Tabs (§3.3): queue = scheduled+publishing+failed+reminder_due,
 * sent = published+partial — so a target still waiting on anything (queued,
 * pending approval, or a reminder someone hasn't marked published yet) keeps
 * the whole post `scheduled` from the composer's point of view; `partial`
 * only appears once nothing is left pending.
 */
export type TargetStatus =
  | 'draft'
  | 'pending_approval'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'reminder_due'
  | 'cancelled';

export type PostStatus = 'draft' | 'pending_approval' | 'scheduled' | 'publishing' | 'published' | 'partial' | 'failed';

const PENDING: ReadonlySet<TargetStatus> = new Set(['draft', 'pending_approval', 'scheduled', 'reminder_due']);

export function recomputePostStatus(targetStatuses: TargetStatus[]): PostStatus {
  const active = targetStatuses.filter((s) => s !== 'cancelled');
  if (active.length === 0) return 'failed';
  if (active.some((s) => s === 'publishing')) return 'publishing';
  if (active.some((s) => PENDING.has(s))) return 'scheduled';

  const published = active.filter((s) => s === 'published').length;
  const failed = active.filter((s) => s === 'failed').length;
  if (published > 0 && failed > 0) return 'partial';
  if (published > 0) return 'published';
  return 'failed';
}
