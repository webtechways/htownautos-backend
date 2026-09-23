import { createHash, randomBytes } from 'crypto';
import { socialFetch } from '../../http/social-http';
import type { ConnectedAccount, RefreshedProfile } from '../types';

/** OAuth 2.0 Authorization Code with PKCE — X's recommended flow (docs.x.com), confidential client. */
export const X_SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access'];

const AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.x.com/2/oauth2/token';

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

/** `code_verifier` (43-128 chars, unreserved) + its S256 `code_challenge`. */
export function generatePkcePair(): PkcePair {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function buildXOAuthUrl(clientId: string, redirectUri: string, state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: X_SCOPES.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

interface XTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
}

interface XUserResponse {
  data: { id: string; username: string; name: string; profile_image_url?: string };
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

export async function connectX(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<ConnectedAccount[]> {
  const res = await socialFetch(TOKEN_URL, {
    platform: 'x',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(clientId, clientSecret),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      client_id: clientId,
    }),
  });
  const data = (await res.json()) as XTokenResponse;

  const userUrl = new URL('https://api.x.com/2/users/me');
  userUrl.searchParams.set('user.fields', 'profile_image_url');
  const userRes = await socialFetch(userUrl.toString(), {
    platform: 'x',
    headers: { Authorization: `Bearer ${data.access_token}` },
  });
  const user = (await userRes.json()) as XUserResponse;

  return [
    {
      platform: 'x',
      accountType: 'profile',
      platformAccountId: user.data.id,
      name: user.data.name,
      username: user.data.username,
      avatarUrl: user.data.profile_image_url ?? null,
      profileUrl: `https://x.com/${user.data.username}`,
      tokens: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? null,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
      },
      scopes: data.scope ? data.scope.split(' ') : X_SCOPES,
    },
  ];
}

/** Re-fetches the account's own profile — same `users/me` call `connectX` makes, used by `refresh()`. */
export async function fetchXProfile(accessToken: string): Promise<RefreshedProfile> {
  const userUrl = new URL('https://api.x.com/2/users/me');
  userUrl.searchParams.set('user.fields', 'profile_image_url');
  const res = await socialFetch(userUrl.toString(), { platform: 'x', headers: { Authorization: `Bearer ${accessToken}` } });
  const user = (await res.json()) as XUserResponse;
  return {
    name: user.data.name,
    username: user.data.username,
    avatarUrl: user.data.profile_image_url ?? null,
    profileUrl: `https://x.com/${user.data.username}`,
  };
}

export async function refreshXToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: Date }> {
  const res = await socialFetch(TOKEN_URL, {
    platform: 'x',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(clientId, clientSecret),
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }),
  });
  const data = (await res.json()) as XTokenResponse;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}
