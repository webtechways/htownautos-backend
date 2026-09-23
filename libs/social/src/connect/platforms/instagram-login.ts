import { socialFetch } from '../../http/social-http';
import type { ConnectedAccount, RefreshedProfile } from '../types';

/**
 * Instagram API with Instagram Login (no Facebook Page required) — the
 * platform's preferred path for a standalone IG Business/Creator account
 * per CONTRACT.md §1. Uses `INSTAGRAM_APP_ID`/`INSTAGRAM_APP_SECRET`
 * (own app, NOT the Facebook Login app — `platformConfig('instagram')`
 * still resolves it with the Facebook fallback, but this flow registers
 * its own redirect URIs on `api.instagram.com`).
 */
export const INSTAGRAM_LOGIN_SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'instagram_business_manage_comments',
  'instagram_business_manage_messages',
  // Account + media insights (B7, CONTRACT.md §3.8).
  'instagram_business_manage_insights',
];

export function buildInstagramLoginOAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: INSTAGRAM_LOGIN_SCOPES.join(','),
    response_type: 'code',
    state,
  });
  return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
}

interface InstagramTokenResponse {
  access_token: string;
  user_id: string;
}

interface InstagramLongLivedResponse {
  access_token: string;
  expires_in: number; // seconds, ~60 days
}

interface InstagramProfile {
  id: string;
  username: string;
  name?: string;
  profile_picture_url?: string;
}

export async function connectInstagramLogin(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<ConnectedAccount[]> {
  const shortRes = await socialFetch('https://api.instagram.com/oauth/access_token', {
    platform: 'instagram',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code,
    }),
  });
  const short = (await shortRes.json()) as InstagramTokenResponse;

  const longUrl = new URL('https://graph.instagram.com/access_token');
  longUrl.searchParams.set('grant_type', 'ig_exchange_token');
  longUrl.searchParams.set('client_secret', clientSecret);
  longUrl.searchParams.set('access_token', short.access_token);
  const longRes = await socialFetch(longUrl.toString(), { platform: 'instagram' });
  const long = (await longRes.json()) as InstagramLongLivedResponse;

  const profileUrl = new URL(`https://graph.instagram.com/${short.user_id}`);
  profileUrl.searchParams.set('fields', 'id,username,name,profile_picture_url');
  profileUrl.searchParams.set('access_token', long.access_token);
  const profileRes = await socialFetch(profileUrl.toString(), { platform: 'instagram' });
  const profile = (await profileRes.json()) as InstagramProfile;

  return [
    {
      platform: 'instagram',
      accountType: 'business',
      platformAccountId: profile.id,
      name: profile.name || profile.username,
      username: profile.username,
      avatarUrl: profile.profile_picture_url ?? null,
      profileUrl: `https://instagram.com/${profile.username}`,
      tokens: {
        accessToken: long.access_token,
        expiresAt: new Date(Date.now() + long.expires_in * 1000),
      },
      scopes: INSTAGRAM_LOGIN_SCOPES,
    },
  ];
}

/** Re-fetches an Instagram Login account's own profile — same fields `connectInstagramLogin` reads, used by `refresh()`. */
export async function fetchInstagramLoginProfile(igId: string, accessToken: string): Promise<RefreshedProfile> {
  const url = new URL(`https://graph.instagram.com/${igId}`);
  url.searchParams.set('fields', 'id,username,name,profile_picture_url');
  url.searchParams.set('access_token', accessToken);
  const res = await socialFetch(url.toString(), { platform: 'instagram' });
  const profile = (await res.json()) as InstagramProfile;
  return {
    name: profile.name || profile.username,
    username: profile.username,
    avatarUrl: profile.profile_picture_url ?? null,
    profileUrl: `https://instagram.com/${profile.username}`,
  };
}

/** Refreshes a long-lived Instagram Login token (must be at least 24h old, valid for 60 more days). */
export async function refreshInstagramLoginToken(accessToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
  const url = new URL('https://graph.instagram.com/refresh_access_token');
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', accessToken);
  const res = await socialFetch(url.toString(), { platform: 'instagram' });
  const data = (await res.json()) as InstagramLongLivedResponse;
  return { accessToken: data.access_token, expiresAt: new Date(Date.now() + data.expires_in * 1000) };
}
