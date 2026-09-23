/** Pure math behind `GET /social/comments/stats` (CONTRACT.md §3.6) — kept separate from Prisma so it's unit-testable without a DB. */
export interface CommentStatsRow {
  status: string;
  repliedAt: Date | null;
  platformCreatedAt: Date;
}

export interface CommentScoreResult {
  /** 0..100 — share of `rows` that are `done` or have a `repliedAt`. */
  commentScore: number;
  /** Average minutes between `platformCreatedAt` and `repliedAt`, for rows that have one. `null` when none do. */
  avgResponseMinutes: number | null;
}

export function computeCommentScore(rows: CommentStatsRow[]): CommentScoreResult {
  if (rows.length === 0) return { commentScore: 0, avgResponseMinutes: null };

  const handled = rows.filter((r) => r.status === 'done' || r.repliedAt !== null);
  const commentScore = Math.round((handled.length / rows.length) * 100);

  const responded = rows.filter((r): r is CommentStatsRow & { repliedAt: Date } => r.repliedAt !== null);
  const avgResponseMinutes =
    responded.length > 0
      ? Math.round(responded.reduce((sum, r) => sum + (r.repliedAt.getTime() - r.platformCreatedAt.getTime()) / 60_000, 0) / responded.length)
      : null;

  return { commentScore, avgResponseMinutes };
}
