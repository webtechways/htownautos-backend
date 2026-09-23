/**
 * Recomputes a `SocialPost.status` from its targets' statuses. Intentional
 * duplicate of `apps/data-sync/src/social/publisher/post-status.ts` (that
 * package's — the publisher owns that copy, this one is api-only and used
 * by `mark-published`, which changes a target's status outside the
 * publisher's own settle path). Apps in this Nx monorepo can't import each
 * other's `src`, and this is a handful of pure lines — same call already
 * made for `SocialNotifierService` (see its own file comment). Keep both in
 * sync if the state machine ever changes.
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
