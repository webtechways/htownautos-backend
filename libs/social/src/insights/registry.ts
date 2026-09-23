import type { SocialPlatform } from '../types';
import type { MetricsAdapter } from './types';
import { facebookMetricsAdapter } from './facebook.metrics';
import { instagramMetricsAdapter } from './instagram.metrics';
import { threadsMetricsAdapter } from './threads.metrics';
import { xMetricsAdapter } from './x.metrics';
import { linkedinMetricsAdapter } from './linkedin.metrics';
import { tiktokMetricsAdapter } from './tiktok.metrics';
import { youtubeMetricsAdapter } from './youtube.metrics';
import { pinterestMetricsAdapter } from './pinterest.metrics';
import { blueskyMetricsAdapter } from './bluesky.metrics';
import { mastodonMetricsAdapter } from './mastodon.metrics';
import { gbpMetricsAdapter } from './gbp.metrics';

/**
 * Platform → metrics adapter (CONTRACT.md §1/§4/§6). WhatsApp is messaging
 * only and has no analytics surface — no entry.
 */
const REGISTRY: Partial<Record<SocialPlatform, MetricsAdapter>> = {
  facebook: facebookMetricsAdapter,
  instagram: instagramMetricsAdapter,
  threads: threadsMetricsAdapter,
  x: xMetricsAdapter,
  linkedin: linkedinMetricsAdapter,
  tiktok: tiktokMetricsAdapter,
  youtube: youtubeMetricsAdapter,
  pinterest: pinterestMetricsAdapter,
  bluesky: blueskyMetricsAdapter,
  mastodon: mastodonMetricsAdapter,
  gbp: gbpMetricsAdapter,
};

export function metricsAdapterFor(platform: SocialPlatform): MetricsAdapter | null {
  return REGISTRY[platform] ?? null;
}
