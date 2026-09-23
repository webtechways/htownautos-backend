import type { Prisma } from '@prisma/client';
import type { PostMetrics, PublishMethod } from '@htownautos/social';
import type { TargetStatus as ContractTargetStatus } from './post-status';
import {
  toAccountSummary,
  toMediaIdsOverride,
  toPlatformOptions,
  toThreadItems,
  toUserSummary,
  type AccountSummaryView,
  type PlatformOptionsView,
  type SocialMediaItemView,
  type UserSummaryView,
} from './mappers';

/** One place all post/target queries build their `include` from (anti-pattern: no inline include trees). */
export const POST_INCLUDE = {
  targets: { include: { account: true } },
  tags: true,
  createdBy: { include: { user: { select: { id: true, name: true, email: true, avatar: true } } } },
  approvedBy: { include: { user: { select: { id: true, name: true, email: true, avatar: true } } } },
} satisfies Prisma.SocialPostInclude;

export type PostWithRelations = Prisma.SocialPostGetPayload<{ include: typeof POST_INCLUDE }>;
export type TargetWithAccount = PostWithRelations['targets'][number];

/** Contract.ts `ScheduleMode` — not re-exported by `@htownautos/social`, defined once here. */
export type ScheduleMode = 'draft' | 'queue' | 'next' | 'now' | 'custom';

export interface PostTargetView {
  id: string;
  accountId: string;
  account: AccountSummaryView;
  status: ContractTargetStatus;
  publishMethod: PublishMethod;
  content: string | null;
  mediaIds: string[] | null;
  media: SocialMediaItemView[] | null;
  options: PlatformOptionsView;
  thread: ReturnType<typeof toThreadItems>;
  firstComment: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  externalId: string | null;
  externalUrl: string | null;
  error: string | null;
  attempts: number;
  metrics: PostMetrics | null;
  metricsUpdatedAt: string | null;
}

export interface SocialPostView {
  id: string;
  status: string;
  content: string;
  mediaIds: string[];
  media: SocialMediaItemView[];
  tags: { id: string; name: string; color: string }[];
  scheduleMode: ScheduleMode;
  scheduledAt: string | null;
  aiGenerated: boolean;
  ideaId: string | null;
  createdBy: UserSummaryView | null;
  approvedBy: UserSummaryView | null;
  approvedAt: string | null;
  rejectionNote: string | null;
  targets: PostTargetView[];
  createdAt: string;
  updatedAt: string;
}

export function toTargetView(target: TargetWithAccount, mediaMap: Map<string, SocialMediaItemView>): PostTargetView {
  const mediaIds = toMediaIdsOverride(target.mediaOverride);
  return {
    id: target.id,
    accountId: target.accountId,
    account: toAccountSummary(target.account),
    status: target.status as ContractTargetStatus,
    publishMethod: target.account.publishMethod as PublishMethod,
    content: target.content,
    mediaIds,
    media: mediaIds ? mediaIds.map((id) => mediaMap.get(id)).filter((m): m is SocialMediaItemView => !!m) : null,
    options: toPlatformOptions(target.options),
    thread: toThreadItems(target.thread),
    firstComment: target.firstComment,
    scheduledAt: target.scheduledAt ? target.scheduledAt.toISOString() : null,
    publishedAt: target.publishedAt ? target.publishedAt.toISOString() : null,
    externalId: target.externalId,
    externalUrl: target.externalUrl,
    error: target.error,
    attempts: target.attempts,
    metrics: (target.metrics as unknown as PostMetrics | null) ?? null,
    metricsUpdatedAt: target.metricsUpdatedAt ? target.metricsUpdatedAt.toISOString() : null,
  };
}

/** Earliest target time — contract's `SocialPost.scheduledAt` isn't a stored column, it's derived. */
function earliestScheduledAt(targets: TargetWithAccount[]): string | null {
  const times = targets.map((t) => t.scheduledAt?.getTime()).filter((t): t is number => typeof t === 'number');
  if (times.length === 0) return null;
  return new Date(Math.min(...times)).toISOString();
}

export function toPostView(post: PostWithRelations, mediaMap: Map<string, SocialMediaItemView>): SocialPostView {
  return {
    id: post.id,
    status: post.status,
    content: post.content,
    mediaIds: post.mediaIds,
    media: post.mediaIds.map((id) => mediaMap.get(id)).filter((m): m is SocialMediaItemView => !!m),
    tags: post.tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    scheduleMode: post.scheduleMode as ScheduleMode,
    scheduledAt: earliestScheduledAt(post.targets),
    aiGenerated: post.aiGenerated,
    ideaId: post.ideaId,
    createdBy: toUserSummary(post.createdBy),
    approvedBy: toUserSummary(post.approvedBy),
    approvedAt: post.approvedAt ? post.approvedAt.toISOString() : null,
    rejectionNote: post.rejectionNote,
    targets: post.targets.map((t) => toTargetView(t, mediaMap)),
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

/** Every SocialMedia id referenced by a post (base + per-target overrides + thread items) — feeds `resolveMediaMap`. */
export function collectMediaIds(post: { mediaIds: string[]; targets: TargetWithAccount[] }): string[] {
  const ids = new Set<string>(post.mediaIds);
  for (const target of post.targets) {
    const override = toMediaIdsOverride(target.mediaOverride);
    if (override) override.forEach((id) => ids.add(id));
    for (const item of toThreadItems(target.thread)) {
      item.mediaIds?.forEach((id) => ids.add(id));
    }
  }
  return Array.from(ids);
}
