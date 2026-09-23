import { SocialApiError } from './http/social-http';
import type { SocialPlatform } from './types';

export interface PlatformAppCredentials {
  clientId: string;
  clientSecret: string;
}

const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  threads: 'Threads',
  x: 'X',
  linkedin: 'LinkedIn',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  pinterest: 'Pinterest',
  bluesky: 'Bluesky',
  mastodon: 'Mastodon',
  gbp: 'Google Business Profile',
  whatsapp: 'WhatsApp',
};

/**
 * App-level OAuth credentials per platform, per docs/social-suite/CONTRACT.md
 * §5. Instagram/Threads/WhatsApp reuse the Facebook app; YouTube and Google
 * Business Profile fall back to the generic Google OAuth app when their own
 * envs aren't set. Bluesky (app password) and Mastodon (per-instance,
 * registered on the fly) have no global app credential — `platformConfig`
 * is not meant to be called for them.
 */
const ENV_MAP: Partial<Record<SocialPlatform, { id: string[]; secret: string[] }>> = {
  facebook: { id: ['FACEBOOK_APP_ID'], secret: ['FACEBOOK_APP_SECRET'] },
  instagram: { id: ['INSTAGRAM_APP_ID', 'FACEBOOK_APP_ID'], secret: ['INSTAGRAM_APP_SECRET', 'FACEBOOK_APP_SECRET'] },
  threads: { id: ['THREADS_APP_ID', 'FACEBOOK_APP_ID'], secret: ['THREADS_APP_SECRET', 'FACEBOOK_APP_SECRET'] },
  x: { id: ['X_CLIENT_ID'], secret: ['X_CLIENT_SECRET'] },
  linkedin: { id: ['LINKEDIN_CLIENT_ID'], secret: ['LINKEDIN_CLIENT_SECRET'] },
  tiktok: { id: ['TIKTOK_CLIENT_KEY'], secret: ['TIKTOK_CLIENT_SECRET'] },
  youtube: { id: ['YOUTUBE_CLIENT_ID', 'GOOGLE_CLIENT_ID'], secret: ['YOUTUBE_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET'] },
  pinterest: { id: ['PINTEREST_APP_ID'], secret: ['PINTEREST_APP_SECRET'] },
  gbp: { id: ['GOOGLE_BUSINESS_CLIENT_ID', 'GOOGLE_CLIENT_ID'], secret: ['GOOGLE_BUSINESS_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET'] },
  whatsapp: { id: ['FACEBOOK_APP_ID'], secret: ['FACEBOOK_APP_SECRET'] },
};

function firstEnv(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

/**
 * Resolves the app-level OAuth credentials for `platform` from env, applying
 * the fallback chain in {@link ENV_MAP}. Throws {@link SocialApiError} with
 * `kind: 'NOT_CONFIGURED'` and a Spanish message when nothing is set — the
 * caller (connect flow) turns that into a 400 instead of crashing.
 */
export function platformConfig(platform: SocialPlatform): PlatformAppCredentials {
  const entry = ENV_MAP[platform];
  if (!entry) {
    throw new SocialApiError({
      platform,
      httpStatus: 0,
      kind: 'NOT_CONFIGURED',
      message: `${PLATFORM_LABEL[platform]} no usa credenciales de app globales`,
    });
  }

  const clientId = firstEnv(entry.id);
  const clientSecret = firstEnv(entry.secret);
  if (!clientId || !clientSecret) {
    throw new SocialApiError({
      platform,
      httpStatus: 0,
      kind: 'NOT_CONFIGURED',
      message: `${PLATFORM_LABEL[platform]} no está configurado`,
    });
  }

  return { clientId, clientSecret };
}

/** Whether `platform` has its app credentials set, without throwing. */
export function isPlatformConfigured(platform: SocialPlatform): boolean {
  try {
    platformConfig(platform);
    return true;
  } catch {
    return false;
  }
}
