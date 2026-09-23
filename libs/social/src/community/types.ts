import type { SocialAccount, SocialComment } from '@prisma/client';
import type { SocialAccountSecrets } from '../connect/types';
import type { NormalizedComment } from '../ingest/social-ingest.service';

/** Everything a community adapter needs to call the platform on behalf of one account. */
export interface CommunityActionContext {
  account: SocialAccount;
  /** Live, non-expired token — already refreshed by `SocialTokenService.getAccessToken`. */
  accessToken: string;
  /** Decrypted `encryptedSecrets` (instance host for Mastodon, identifier/DID for Bluesky, etc.). */
  secrets: SocialAccountSecrets;
}

export interface FetchSinceOptions {
  /**
   * `SocialPostTarget.externalId` of this account's own recently-published
   * posts, most recent first (capped by the poller). Platforms whose
   * comment API is scoped per-post (Facebook, Instagram, Threads, LinkedIn)
   * poll these; account-level platforms (YouTube, Bluesky, Mastodon, X,
   * GBP) ignore it.
   */
  postExternalIds: string[];
  /**
   * Opaque cursor from `SocialAccount.metaValue.commentsSince` — an ISO
   * timestamp for platforms with a time-based `since` filter, or the last
   * seen id for platforms that only page by id (Mastodon, X). `null` on the
   * account's first poll.
   */
  since: string | null;
}

export interface FetchSinceResult {
  items: NormalizedComment[];
  /** New value to persist as `SocialAccount.metaValue.commentsSince`. Unchanged from `since` when nothing new came in. */
  cursor: string;
}

export interface ReplyResult {
  externalId: string;
  permalink: string | null;
}

/**
 * One implementation per platform (`libs/social/src/community/<platform>.comments.ts`
 * or `.reviews.ts` for GBP). `fetchSince` is required; every action is
 * omitted entirely (not a no-op) on platforms/actions the API doesn't
 * support — callers check `typeof adapter.reply === 'function'`, mirroring
 * `SocialPublisher` in `libs/social/src/publish/types.ts`.
 */
export interface CommunityAdapter {
  fetchSince(ctx: CommunityActionContext, opts: FetchSinceOptions): Promise<FetchSinceResult>;
  reply?(ctx: CommunityActionContext, comment: SocialComment, text: string): Promise<ReplyResult>;
  like?(ctx: CommunityActionContext, comment: SocialComment): Promise<void>;
  unlike?(ctx: CommunityActionContext, comment: SocialComment): Promise<void>;
  hide?(ctx: CommunityActionContext, comment: SocialComment): Promise<void>;
  unhide?(ctx: CommunityActionContext, comment: SocialComment): Promise<void>;
  delete?(ctx: CommunityActionContext, comment: SocialComment): Promise<void>;
}
