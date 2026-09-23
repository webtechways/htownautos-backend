import type { Prisma, SocialAccount as PrismaSocialAccount, SocialComment as PrismaSocialComment } from '@prisma/client';
import { capabilitiesFor, communityAdapterFor, type AccountCapabilities, type AccountType, type CommentKind, type CommentStatus, type PublishMethod, type SocialPlatform } from '@htownautos/social';
import { toAccountSummary, type AccountSummaryView } from '../posts/mappers';

/** Verbatim shape of contract.ts `SocialComment`. */
export interface SocialCommentView {
  id: string;
  accountId: string;
  account: AccountSummaryView;
  platform: SocialPlatform;
  kind: CommentKind;
  status: CommentStatus;
  externalId: string;
  parentId: string | null;
  postTargetId: string | null;
  postPreview: { text: string | null; mediaUrl: string | null; url: string | null } | null;
  authorName: string;
  authorHandle: string | null;
  authorAvatarUrl: string | null;
  authorExternalId: string | null;
  body: string;
  permalink: string | null;
  rating: number | null;
  fromUs: boolean;
  isHidden: boolean;
  likedByUs: boolean;
  replyCount: number;
  repliedAt: string | null;
  canReply: boolean;
  canLike: boolean;
  canHide: boolean;
  canDelete: boolean;
  createdAt: string;
}

function accountMetaDisabled(account: PrismaSocialAccount): boolean {
  const meta = account.metaValue;
  return !!(meta && typeof meta === 'object' && !Array.isArray(meta) && (meta as Record<string, unknown>).commentsPollDisabledAt);
}

/** Which `AccountCapabilities` flag gates this comment's `kind` — reviews (GBP) and mentions use their own flag, not `comments`. */
function hasSurface(caps: AccountCapabilities, kind: CommentKind): boolean {
  if (kind === 'review') return caps.reviews;
  if (kind === 'mention') return caps.mentions;
  return caps.comments;
}

function toPostPreview(json: Prisma.JsonValue | null): { text: string | null; mediaUrl: string | null; url: string | null } | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;
  return {
    text: typeof obj.text === 'string' ? obj.text : null,
    mediaUrl: typeof obj.mediaUrl === 'string' ? obj.mediaUrl : null,
    url: typeof obj.url === 'string' ? obj.url : null,
  };
}

export function toCommentView(comment: PrismaSocialComment & { account: PrismaSocialAccount }, replyCount = 0): SocialCommentView {
  const platform = comment.platform as SocialPlatform;
  const kind = comment.kind as CommentKind;
  const caps = capabilitiesFor(platform, comment.account.accountType as AccountType | null, comment.account.publishMethod as PublishMethod);
  const adapter = communityAdapterFor(platform);
  const enabled = hasSurface(caps, kind) && !comment.fromUs && !accountMetaDisabled(comment.account);

  return {
    id: comment.id,
    accountId: comment.accountId,
    account: toAccountSummary(comment.account),
    platform,
    kind,
    status: comment.status as CommentStatus,
    externalId: comment.externalId,
    parentId: comment.parentId,
    postTargetId: comment.postTargetId,
    postPreview: toPostPreview(comment.postPreview),
    authorName: comment.authorName,
    authorHandle: comment.authorHandle,
    authorAvatarUrl: comment.authorAvatarUrl,
    authorExternalId: comment.authorExternalId,
    body: comment.body,
    permalink: comment.permalink,
    rating: comment.rating,
    fromUs: comment.fromUs,
    isHidden: comment.isHidden,
    likedByUs: comment.likedByUs,
    replyCount,
    repliedAt: comment.repliedAt ? comment.repliedAt.toISOString() : null,
    canReply: enabled && typeof adapter?.reply === 'function',
    // `canLike`/`canHide` cover the toggle both ways — the frontend picks like/unlike or hide/unhide from `likedByUs`/`isHidden`.
    canLike: enabled && typeof adapter?.like === 'function',
    canHide: enabled && typeof adapter?.hide === 'function',
    canDelete: enabled && typeof adapter?.delete === 'function',
    createdAt: comment.platformCreatedAt.toISOString(),
  };
}
