import type { SocialPlatform } from '../types';
import type { CommunityAdapter } from './types';
import { facebookCommentsAdapter } from './facebook.comments';
import { instagramCommentsAdapter } from './instagram.comments';
import { threadsCommentsAdapter } from './threads.comments';
import { youtubeCommentsAdapter } from './youtube.comments';
import { linkedinCommentsAdapter } from './linkedin.comments';
import { blueskyCommentsAdapter } from './bluesky.comments';
import { mastodonCommentsAdapter } from './mastodon.comments';
import { xCommentsAdapter } from './x.comments';
import { gbpReviewsAdapter } from './gbp.reviews';

/**
 * Platform → community adapter (CONTRACT.md §1/§4). TikTok has no comments
 * surface in Login Kit, Pinterest and WhatsApp have no comment/review
 * concept — none of the three get an entry.
 */
const REGISTRY: Partial<Record<SocialPlatform, CommunityAdapter>> = {
  facebook: facebookCommentsAdapter,
  instagram: instagramCommentsAdapter,
  threads: threadsCommentsAdapter,
  youtube: youtubeCommentsAdapter,
  linkedin: linkedinCommentsAdapter,
  bluesky: blueskyCommentsAdapter,
  mastodon: mastodonCommentsAdapter,
  x: xCommentsAdapter,
  gbp: gbpReviewsAdapter,
};

/** Polled every 5 min (CONTRACT.md §4). */
export const COMMUNITY_POLL_PLATFORMS: SocialPlatform[] = ['youtube', 'threads', 'linkedin', 'bluesky', 'mastodon', 'x', 'gbp'];
/** Backfill only every 30 min — the Meta webhook (`apps/api/src/social/webhooks`) is primary. */
export const COMMUNITY_BACKFILL_PLATFORMS: SocialPlatform[] = ['facebook', 'instagram'];

export function communityAdapterFor(platform: SocialPlatform): CommunityAdapter | null {
  return REGISTRY[platform] ?? null;
}
