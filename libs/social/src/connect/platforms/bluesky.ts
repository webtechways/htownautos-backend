import { socialFetch, SocialApiError } from '../../http/social-http';
import type { ConnectedAccount } from '../types';

/**
 * Bluesky has no OAuth app in this suite — the tenant supplies an AT
 * Protocol app password directly. `identifier` (handle or DID) and
 * `appPassword` are both kept in `extraSecrets` so the token service can
 * re-`createSession` when the session JWT expires (Bluesky sessions are
 * short-lived; there's no long-lived refresh outside `refreshJwt`, which
 * itself expires).
 */
export const BLUESKY_SCOPES = ['atproto'];

interface BlueskySession {
  did: string;
  handle: string;
  accessJwt: string;
  refreshJwt: string;
}

export async function connectBluesky(identifier: string, appPassword: string): Promise<ConnectedAccount[]> {
  const res = await socialFetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
    platform: 'bluesky',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: appPassword }),
  });
  const data = (await res.json()) as BlueskySession;
  if (!data.did) {
    throw new SocialApiError({ platform: 'bluesky', httpStatus: 0, kind: 'AUTH', message: 'Bluesky no devolvió una sesión válida' });
  }

  return [
    {
      platform: 'bluesky',
      accountType: 'profile',
      platformAccountId: data.did,
      name: data.handle,
      username: data.handle,
      profileUrl: `https://bsky.app/profile/${data.handle}`,
      tokens: { accessToken: data.accessJwt, refreshToken: data.refreshJwt, expiresAt: null },
      extraSecrets: { identifier, appPassword },
      scopes: BLUESKY_SCOPES,
    },
  ];
}

/** Refreshes the session JWT pair; on failure the caller falls back to {@link connectBluesky} with the stored app password. */
export async function refreshBlueskySession(refreshJwt: string): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await socialFetch('https://bsky.social/xrpc/com.atproto.server.refreshSession', {
    platform: 'bluesky',
    method: 'POST',
    headers: { Authorization: `Bearer ${refreshJwt}` },
  });
  const data = (await res.json()) as BlueskySession;
  return { accessToken: data.accessJwt, refreshToken: data.refreshJwt };
}
