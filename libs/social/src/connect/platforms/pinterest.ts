import { socialFetch } from '../../http/social-http';
import type { ConnectedAccount, RefreshedProfile } from '../types';

export const PINTEREST_SCOPES = ['boards:read', 'boards:write', 'pins:read', 'pins:write', 'user_accounts:read'];

export function buildPinterestOAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: PINTEREST_SCOPES.join(','),
    response_type: 'code',
    state,
  });
  return `https://www.pinterest.com/oauth/?${params.toString()}`;
}

interface PinterestTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface PinterestUser {
  username: string;
  business_name?: string;
  profile_image?: string;
}

export async function connectPinterest(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<ConnectedAccount[]> {
  const res = await socialFetch('https://api.pinterest.com/v5/oauth/token', {
    platform: 'pinterest',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({ code, grant_type: 'authorization_code', redirect_uri: redirectUri }),
  });
  const data = (await res.json()) as PinterestTokenResponse;

  const userRes = await socialFetch('https://api.pinterest.com/v5/user_account', {
    platform: 'pinterest',
    headers: { Authorization: `Bearer ${data.access_token}` },
  });
  const user = (await userRes.json()) as PinterestUser;

  return [
    {
      platform: 'pinterest',
      accountType: 'profile',
      platformAccountId: user.username || 'unknown',
      name: user.business_name || user.username || 'Pinterest Account',
      username: user.username ?? null,
      avatarUrl: user.profile_image ?? null,
      profileUrl: user.username ? `https://pinterest.com/${user.username}` : null,
      tokens: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
      },
      scopes: PINTEREST_SCOPES,
    },
  ];
}

/** Re-fetches the account's own profile — same `user_account` call `connectPinterest` makes, used by `refresh()`. */
export async function fetchPinterestProfile(accessToken: string): Promise<RefreshedProfile> {
  const res = await socialFetch('https://api.pinterest.com/v5/user_account', {
    platform: 'pinterest',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const user = (await res.json()) as PinterestUser;
  return {
    name: user.business_name || user.username || 'Pinterest Account',
    username: user.username ?? null,
    avatarUrl: user.profile_image ?? null,
    profileUrl: user.username ? `https://pinterest.com/${user.username}` : null,
  };
}

export async function refreshPinterestToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: Date }> {
  const res = await socialFetch('https://api.pinterest.com/v5/oauth/token', {
    platform: 'pinterest',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  const data = (await res.json()) as PinterestTokenResponse;
  return { accessToken: data.access_token, expiresAt: new Date(Date.now() + data.expires_in * 1000) };
}

interface PinterestBoardsResponse {
  items?: { id: string; name: string }[];
}

export async function listPinterestBoards(accessToken: string): Promise<{ id: string; name: string }[]> {
  const res = await socialFetch('https://api.pinterest.com/v5/boards?page_size=100', {
    platform: 'pinterest',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = (await res.json()) as PinterestBoardsResponse;
  return (data.items || []).map((b) => ({ id: b.id, name: b.name }));
}
