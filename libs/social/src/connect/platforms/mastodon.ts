import { socialFetch, SocialApiError } from '../../http/social-http';
import type { ConnectedAccount, RefreshedProfile } from '../types';

/** Mastodon has no fixed app registry — every instance gets its own app, registered on the fly. */
export const MASTODON_SCOPES = ['read', 'write'];

function normalizeInstance(instance: string): string {
  // `instance` per contract is scheme-less ("mastodon.social"); guard against a pasted URL anyway.
  return instance.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

export interface MastodonAppCredentials {
  clientId: string;
  clientSecret: string;
}

/** POST /api/v1/apps on the target instance — no auth required, per Mastodon's public app-registration endpoint. */
export async function registerMastodonApp(instance: string, redirectUri: string): Promise<MastodonAppCredentials> {
  const host = normalizeInstance(instance);
  const res = await socialFetch(`https://${host}/api/v1/apps`, {
    platform: 'mastodon',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'HTownAutos Social Suite',
      redirect_uris: redirectUri,
      scopes: MASTODON_SCOPES.join(' '),
      website: 'https://htownautos.com',
    }),
  });
  const data = (await res.json()) as { client_id: string; client_secret: string };
  return { clientId: data.client_id, clientSecret: data.client_secret };
}

export function buildMastodonOAuthUrl(instance: string, clientId: string, redirectUri: string, state: string): string {
  const host = normalizeInstance(instance);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: MASTODON_SCOPES.join(' '),
    state,
  });
  return `https://${host}/oauth/authorize?${params.toString()}`;
}

interface MastodonTokenResponse {
  access_token: string;
}

interface MastodonAccount {
  id: string;
  username: string;
  display_name?: string;
  avatar?: string;
  url?: string;
}

/** Mastodon access tokens don't expire by default — `tokens.expiresAt` is always null. */
export async function connectMastodon(
  instance: string,
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<ConnectedAccount[]> {
  const host = normalizeInstance(instance);
  const res = await socialFetch(`https://${host}/oauth/token`, {
    platform: 'mastodon',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code,
      scope: MASTODON_SCOPES.join(' '),
    }),
  });
  const data = (await res.json()) as MastodonTokenResponse;
  if (!data.access_token) {
    throw new SocialApiError({ platform: 'mastodon', httpStatus: 0, kind: 'AUTH', message: `${host} no devolvió un access_token` });
  }

  const accRes = await socialFetch(`https://${host}/api/v1/accounts/verify_credentials`, {
    platform: 'mastodon',
    headers: { Authorization: `Bearer ${data.access_token}` },
  });
  const account = (await accRes.json()) as MastodonAccount;

  return [
    {
      platform: 'mastodon',
      accountType: 'profile',
      platformAccountId: account.id,
      name: account.display_name || account.username,
      username: `${account.username}@${host}`,
      avatarUrl: account.avatar ?? null,
      profileUrl: account.url ?? `https://${host}/@${account.username}`,
      tokens: { accessToken: data.access_token, expiresAt: null },
      extraSecrets: { instance: host, clientId, clientSecret },
      scopes: MASTODON_SCOPES,
    },
  ];
}

/** Re-fetches the account's own profile — same `verify_credentials` call `connectMastodon` makes, used by `refresh()`. `instance` comes from the stored `extraSecrets.instance` (already host-normalized). */
export async function fetchMastodonProfile(instance: string, accessToken: string): Promise<RefreshedProfile> {
  const res = await socialFetch(`https://${instance}/api/v1/accounts/verify_credentials`, {
    platform: 'mastodon',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const account = (await res.json()) as MastodonAccount;
  return {
    name: account.display_name || account.username,
    username: `${account.username}@${instance}`,
    avatarUrl: account.avatar ?? null,
    profileUrl: account.url ?? `https://${instance}/@${account.username}`,
  };
}
