import type { AccountCapabilities, AccountType, PublishMethod, SocialPlatform } from './types';

const NONE: AccountCapabilities = {
  publish: false,
  comments: false,
  mentions: false,
  reviews: false,
  messages: false,
  analytics: false,
};

/** Baseline capability set for a normally-connectable account of each platform, per CONTRACT.md §1. */
const BASE: Record<SocialPlatform, AccountCapabilities> = {
  facebook: { publish: true, comments: true, mentions: false, reviews: false, messages: true, analytics: true },
  instagram: { publish: true, comments: true, mentions: true, reviews: false, messages: true, analytics: true },
  threads: { publish: true, comments: true, mentions: true, reviews: false, messages: false, analytics: true },
  x: { publish: true, comments: false, mentions: true, reviews: false, messages: true, analytics: true },
  linkedin: { publish: true, comments: true, mentions: false, reviews: false, messages: false, analytics: true },
  tiktok: { publish: true, comments: false, mentions: false, reviews: false, messages: false, analytics: true },
  youtube: { publish: true, comments: true, mentions: false, reviews: false, messages: false, analytics: true },
  pinterest: { publish: true, comments: false, mentions: false, reviews: false, messages: false, analytics: true },
  bluesky: { publish: true, comments: true, mentions: true, reviews: false, messages: true, analytics: true },
  mastodon: { publish: true, comments: true, mentions: true, reviews: false, messages: true, analytics: true },
  gbp: { publish: true, comments: false, mentions: false, reviews: true, messages: false, analytics: true },
  whatsapp: { publish: false, comments: false, mentions: false, reviews: false, messages: true, analytics: false },
};

/**
 * Account types that Meta gives NO interaction surface for — only reminder
 * publishing (Facebook removed group publishing from the API in 2024;
 * Instagram personal accounts were never opened to the Graph API).
 */
const INTERACTION_LESS: Partial<Record<SocialPlatform, AccountType[]>> = {
  facebook: ['group'],
  instagram: ['personal'],
  tiktok: ['personal'],
};

/**
 * Resolves what an account can do, per CONTRACT §1, combining the platform's
 * baseline with `accountType` overrides (a Facebook Group or an Instagram
 * personal account loses every interaction surface, reminder-only) and
 * `publishMethod` (an account whose publish method is "none" can't compose
 * posts targeting it at all — currently only WhatsApp).
 */
export function capabilitiesFor(
  platform: SocialPlatform,
  accountType: AccountType | null | undefined,
  publishMethod: PublishMethod,
): AccountCapabilities {
  if (publishMethod === 'none') {
    return { ...NONE, messages: BASE[platform]?.messages ?? false };
  }

  const base = BASE[platform] ?? NONE;
  const loses = accountType && INTERACTION_LESS[platform]?.includes(accountType);
  if (!loses) {
    return { ...base, publish: true };
  }

  return {
    publish: true, // still publishable — just via `reminder`, not the API
    comments: false,
    mentions: false,
    reviews: false,
    messages: false,
    analytics: false,
  };
}
