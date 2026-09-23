import { socialFetch } from '../../http/social-http';
import type { ConnectedAccount, RefreshedProfile } from '../types';

/** TikTok Login Kit. `video.publish` needs an audited app; unaudited apps fall back to SELF_ONLY visibility. */
/** `user.info.stats` adds `follower_count` for account-daily metrics (B7, CONTRACT.md §3.8). */
export const TIKTOK_SCOPES = ['user.info.basic', 'user.info.stats', 'video.publish', 'video.upload', 'video.list'];

export function buildTikTokOAuthUrl(clientKey: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_key: clientKey,
    scope: TIKTOK_SCOPES.join(','),
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
}

interface TikTokTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  open_id: string;
  scope: string;
}

interface TikTokUserInfo {
  data?: { user?: { open_id: string; display_name: string; avatar_url: string; username?: string } };
}

export async function connectTikTok(
  clientKey: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<ConnectedAccount[]> {
  const res = await socialFetch('https://open.tiktokapis.com/v2/oauth/token/', {
    platform: 'tiktok',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  const data = (await res.json()) as TikTokTokenResponse;

  const userRes = await socialFetch(
    'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url,username',
    { platform: 'tiktok', headers: { Authorization: `Bearer ${data.access_token}` } },
  );
  const userData = (await userRes.json()) as TikTokUserInfo;
  const user = userData.data?.user;

  return [
    {
      platform: 'tiktok',
      accountType: 'business',
      platformAccountId: data.open_id,
      name: user?.display_name || 'TikTok Account',
      username: user?.username ?? null,
      avatarUrl: user?.avatar_url ?? null,
      profileUrl: user?.username ? `https://www.tiktok.com/@${user.username}` : null,
      tokens: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
      },
      scopes: data.scope ? data.scope.split(',') : TIKTOK_SCOPES,
    },
  ];
}

/** Re-fetches the account's own profile — same `user/info` call `connectTikTok` makes, used by `refresh()`. */
export async function fetchTikTokProfile(accessToken: string): Promise<RefreshedProfile> {
  const res = await socialFetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url,username', {
    platform: 'tiktok',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const userData = (await res.json()) as TikTokUserInfo;
  const user = userData.data?.user;
  return {
    name: user?.display_name || 'TikTok Account',
    username: user?.username ?? null,
    avatarUrl: user?.avatar_url ?? null,
    profileUrl: user?.username ? `https://www.tiktok.com/@${user.username}` : null,
  };
}

export async function refreshTikTokToken(
  clientKey: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
  const res = await socialFetch('https://open.tiktokapis.com/v2/oauth/token/', {
    platform: 'tiktok',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  const data = (await res.json()) as TikTokTokenResponse;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}
