import type { SocialAccount, SocialPostTarget, SocialMedia } from '@prisma/client';
import type { MediaResolverService } from '../media/media-resolver.service';
import type { PublishablePlatform } from '../types';
import type { SocialAccountSecrets } from '../connect/types';

/**
 * Verbatim mirror of docs/social-suite/contract.ts `PlatformOptions` — only
 * the key matching the target's own platform is ever populated
 * (`SocialPostTarget.options` stores e.g. `{ "instagram": { ... } }`).
 */
export interface PlatformOptions {
  instagram?: { postType: 'post' | 'reel' | 'story'; shareReelToFeed?: boolean; collaborators?: string[] };
  facebook?: { postType: 'post' | 'reel' | 'story' };
  youtube?: {
    title: string;
    privacy: 'public' | 'unlisted' | 'private';
    categoryId?: string;
    madeForKids: boolean;
    tags?: string[];
    notifySubscribers?: boolean;
  };
  tiktok?: {
    privacyLevel: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY';
    disableComment: boolean;
    disableDuet: boolean;
    disableStitch: boolean;
    brandContentToggle: boolean;
    brandOrganicToggle: boolean;
    isAigc?: boolean;
    title?: string;
  };
  pinterest?: { boardId: string; title?: string; link?: string };
  linkedin?: { visibility?: 'PUBLIC' | 'CONNECTIONS'; documentTitle?: string };
  gbp?: {
    topicType: 'STANDARD' | 'EVENT' | 'OFFER';
    ctaType?: 'BOOK' | 'ORDER' | 'SHOP' | 'LEARN_MORE' | 'SIGN_UP' | 'CALL';
    ctaUrl?: string;
    event?: { title: string; startAt: string; endAt: string };
    offer?: { couponCode?: string; redeemUrl?: string; terms?: string };
  };
  x?: { replySettings?: 'everyone' | 'following' | 'mentionedUsers' };
  mastodon?: { visibility: 'public' | 'unlisted' | 'private' | 'direct'; spoilerText?: string; sensitive?: boolean; language?: string };
  bluesky?: { langs?: string[] };
  threads?: { replyControl?: 'everyone' | 'accounts_you_follow' | 'mentioned_only' };
}

export interface PublishThreadItem {
  content: string;
  mediaIds: string[];
}

export interface PublishResult {
  externalId: string;
  externalUrl: string | null;
}

/**
 * Everything a platform publisher needs for one target. Built once by the
 * runner (`apps/data-sync/src/social/publisher/publish-runner.service.ts`)
 * and reused for the main post, every thread item, and the first comment.
 */
export interface PublishContext {
  tenantId: string;
  platform: PublishablePlatform;
  account: SocialAccount;
  target: SocialPostTarget;
  /** Live, non-expired token — already refreshed by `SocialTokenService.getAccessToken`. */
  accessToken: string;
  /** Decrypted `encryptedSecrets` (instance host for Mastodon, identifier for Bluesky, etc.) — same object `accessToken` came from. */
  secrets: SocialAccountSecrets;
  /** Resolved post/target text, link-shortened + UTM'd, ready to send as-is. */
  content: string;
  /** Resolved media ids for the main post (target override, else the post's own). */
  mediaIds: string[];
  /** Every `SocialMedia` row referenced anywhere in this publish (main post + thread items), keyed by id. */
  mediaById: Map<string, SocialMedia>;
  options: PlatformOptions;
  resolver: MediaResolverService;
  /**
   * Re-encodes `buffer` to a throwaway object in the private bucket and
   * returns a fresh signed GET URL to it (~1h). Needed by platforms whose
   * publish API only accepts a fetchable URL (Instagram/Threads containers)
   * but whose source media isn't already a format the platform accepts —
   * `resolver.toJpeg`/`fitUnder` produce bytes, this gives them back a URL.
   * Implemented by the runner (has `S3Service`); not part of
   * `MediaResolverService` itself, which is frozen for this package.
   */
  reuploadTemp: (buffer: Buffer, ext: string, contentType: string) => Promise<string>;
}

/**
 * One implementation per platform (`libs/social/src/publish/<platform>.publisher.ts`).
 * `publish` does the main post; `publishThreadItem`/`postFirstComment` are
 * omitted entirely (not just no-ops) on platforms that don't support them —
 * the runner checks `typeof publisher.publishThreadItem === 'function'`.
 */
/** `root` = the main post's result; `parent` = the previous item in the chain (root itself for the first reply). Some platforms (Bluesky/AT Proto) need both — X/Threads/Mastodon only use `parent`. */
export interface ThreadChain {
  root: PublishResult;
  parent: PublishResult;
}

export interface SocialPublisher {
  publish(ctx: PublishContext): Promise<PublishResult>;
  publishThreadItem?(ctx: PublishContext, chain: ThreadChain, item: PublishThreadItem, index: number): Promise<PublishResult>;
  postFirstComment?(ctx: PublishContext, parentExternalId: string, comment: string): Promise<void>;
}

export function mediaFor(ctx: PublishContext, ids: string[]): SocialMedia[] {
  return ids.map((id) => ctx.mediaById.get(id)).filter((m): m is SocialMedia => !!m);
}
