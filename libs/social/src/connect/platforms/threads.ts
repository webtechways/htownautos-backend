import { socialFetch } from '../../http/social-http';
import type { ConnectedAccount, RefreshedProfile } from '../types';

export const THREADS_SCOPES = [
  'threads_basic',
  'threads_content_publish',
  'threads_manage_replies',
  'threads_read_replies',
  // Account + media insights (B7, CONTRACT.md §3.8).
  'threads_manage_insights',
];

export function buildThreadsOAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: THREADS_SCOPES.join(','),
    response_type: 'code',
    state,
  });
  return `https://threads.net/oauth/authorize?${params.toString()}`;
}

interface ThreadsTokenResponse {
  access_token: string;
  user_id: string;
}

interface ThreadsLongLivedResponse {
  access_token: string;
  expires_in: number; // seconds, ~60 days
}

interface ThreadsProfile {
  id: string;
  username?: string;
  name?: string;
  threads_profile_picture_url?: string;
}

export async function connectThreads(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<ConnectedAccount[]> {
  const shortRes = await socialFetch('https://graph.threads.net/oauth/access_token', {
    platform: 'threads',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  const short = (await shortRes.json()) as ThreadsTokenResponse;

  // Short-lived → long-lived exchange (~60 days), per CONTRACT.md.
  const longUrl = new URL('https://graph.threads.net/access_token');
  longUrl.searchParams.set('grant_type', 'th_exchange_token');
  longUrl.searchParams.set('client_secret', clientSecret);
  longUrl.searchParams.set('access_token', short.access_token);
  const longRes = await socialFetch(longUrl.toString(), { platform: 'threads' });
  const long = (await longRes.json()) as ThreadsLongLivedResponse;
  const token = long.access_token || short.access_token;

  const profileUrl = new URL(`https://graph.threads.net/v1.0/${short.user_id}`);
  profileUrl.searchParams.set('fields', 'id,username,name,threads_profile_picture_url');
  profileUrl.searchParams.set('access_token', token);
  const profileRes = await socialFetch(profileUrl.toString(), { platform: 'threads' });
  const profile = (await profileRes.json()) as ThreadsProfile;

  return [
    {
      platform: 'threads',
      accountType: 'profile',
      platformAccountId: profile.id || short.user_id,
      name: profile.name || profile.username || 'Threads Account',
      username: profile.username ?? null,
      avatarUrl: profile.threads_profile_picture_url ?? null,
      profileUrl: profile.username ? `https://threads.net/@${profile.username}` : null,
      tokens: {
        accessToken: token,
        expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : null,
      },
      scopes: THREADS_SCOPES,
    },
  ];
}

/** Re-fetches a Threads account's own profile — same fields `connectThreads` reads, used by `refresh()`. */
export async function fetchThreadsProfile(userId: string, accessToken: string): Promise<RefreshedProfile> {
  const url = new URL(`https://graph.threads.net/v1.0/${userId}`);
  url.searchParams.set('fields', 'id,username,name,threads_profile_picture_url');
  url.searchParams.set('access_token', accessToken);
  const res = await socialFetch(url.toString(), { platform: 'threads' });
  const profile = (await res.json()) as ThreadsProfile;
  return {
    name: profile.name || profile.username || 'Threads Account',
    username: profile.username ?? null,
    avatarUrl: profile.threads_profile_picture_url ?? null,
    profileUrl: profile.username ? `https://threads.net/@${profile.username}` : null,
  };
}

/** Threads has no refresh token — a long-lived token can be re-exchanged for a fresh 60-day one before it expires. */
export async function refreshThreadsToken(accessToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
  const url = new URL('https://graph.threads.net/refresh_access_token');
  url.searchParams.set('grant_type', 'th_refresh_token');
  url.searchParams.set('access_token', accessToken);
  const res = await socialFetch(url.toString(), { platform: 'threads' });
  const data = (await res.json()) as ThreadsLongLivedResponse;
  return { accessToken: data.access_token, expiresAt: new Date(Date.now() + data.expires_in * 1000) };
}
