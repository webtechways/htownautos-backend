import type { PublishablePlatform } from '../types';
import type { SocialPublisher } from './types';
import { facebookPublisher } from './facebook.publisher';
import { instagramPublisher } from './instagram.publisher';
import { threadsPublisher } from './threads.publisher';
import { xPublisher } from './x.publisher';
import { linkedinPublisher } from './linkedin.publisher';
import { tiktokPublisher } from './tiktok.publisher';
import { youtubePublisher } from './youtube.publisher';
import { pinterestPublisher } from './pinterest.publisher';
import { blueskyPublisher } from './bluesky.publisher';
import { mastodonPublisher } from './mastodon.publisher';
import { gbpPublisher } from './gbp.publisher';

/** One entry per `PublishablePlatform` (contract.ts) — the runner looks up `PLATFORM_PUBLISHERS[account.platform]`. */
export const PLATFORM_PUBLISHERS: Record<PublishablePlatform, SocialPublisher> = {
  facebook: facebookPublisher,
  instagram: instagramPublisher,
  threads: threadsPublisher,
  x: xPublisher,
  linkedin: linkedinPublisher,
  tiktok: tiktokPublisher,
  youtube: youtubePublisher,
  pinterest: pinterestPublisher,
  bluesky: blueskyPublisher,
  mastodon: mastodonPublisher,
  gbp: gbpPublisher,
};

export * from './types';
export * from './chunk-source';
export * from './bluesky-facets';
export * from './link-shortening';
export * from './bytes';
