import { socialFetch } from '../../http/social-http';
import type { ConnectedAccount } from '../types';

/** YouTube (`YOUTUBE_CLIENT_ID`/`SECRET`, fallback `GOOGLE_CLIENT_ID`/`SECRET`). */
export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.force-ssl',
];

/** Google Business Profile (`GOOGLE_BUSINESS_CLIENT_ID`/`SECRET`, fallback `GOOGLE_CLIENT_ID`/`SECRET`). */
export const GBP_SCOPES = ['https://www.googleapis.com/auth/business.manage'];

export function buildGoogleOAuthUrl(clientId: string, redirectUri: string, state: string, scopes: string[]): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function exchangeGoogleCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<GoogleTokenResponse> {
  const res = await socialFetch('https://oauth2.googleapis.com/token', {
    platform: 'youtube',
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
  return res.json() as Promise<GoogleTokenResponse>;
}

export async function refreshGoogleToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: Date }> {
  const res = await socialFetch('https://oauth2.googleapis.com/token', {
    platform: 'youtube',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = (await res.json()) as GoogleTokenResponse;
  return { accessToken: data.access_token, expiresAt: new Date(Date.now() + data.expires_in * 1000) };
}

interface YouTubeChannelsResponse {
  items?: { id: string; snippet: { title: string; thumbnails?: { default?: { url?: string } } } }[];
}

export async function connectYouTube(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<ConnectedAccount[]> {
  // Google only returns a refresh_token the FIRST time a user consents for
  // this client+scopes; a reconnect without `prompt=consent&access_type=offline`
  // (already forced in buildGoogleOAuthUrl) would silently omit it.
  const data = await exchangeGoogleCode(clientId, clientSecret, code, redirectUri);
  const chRes = await socialFetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
    platform: 'youtube',
    headers: { Authorization: `Bearer ${data.access_token}` },
  });
  const chData = (await chRes.json()) as YouTubeChannelsResponse;
  const channel = chData.items?.[0];

  return [
    {
      platform: 'youtube',
      accountType: 'channel',
      platformAccountId: channel?.id || 'unknown',
      name: channel?.snippet?.title || 'YouTube Channel',
      avatarUrl: channel?.snippet?.thumbnails?.default?.url ?? null,
      profileUrl: channel?.id ? `https://youtube.com/channel/${channel.id}` : null,
      tokens: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? null,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
      },
      scopes: YOUTUBE_SCOPES,
    },
  ];
}

interface GbpAccountsResponse {
  accounts?: { name: string; accountName?: string }[];
}

interface GbpLocationsResponse {
  locations?: { name: string; title?: string }[];
}

/** GBP connects at the location level — one `SocialAccount` per business location under the user's account(s). */
export async function connectGbp(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<ConnectedAccount[]> {
  const data = await exchangeGoogleCode(clientId, clientSecret, code, redirectUri);

  const accRes = await socialFetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
    platform: 'gbp',
    headers: { Authorization: `Bearer ${data.access_token}` },
  });
  const accData = (await accRes.json()) as GbpAccountsResponse;

  const accounts: ConnectedAccount[] = [];
  for (const acc of accData.accounts || []) {
    const locUrl = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${acc.name}/locations`);
    locUrl.searchParams.set('readMask', 'name,title');
    const locRes = await socialFetch(locUrl.toString(), {
      platform: 'gbp',
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    const locData = (await locRes.json()) as GbpLocationsResponse;
    for (const loc of locData.locations || []) {
      accounts.push({
        platform: 'gbp',
        accountType: 'location',
        platformAccountId: loc.name,
        name: loc.title || acc.accountName || 'Google Business Profile',
        profileUrl: null,
        tokens: {
          accessToken: data.access_token,
          refreshToken: data.refresh_token ?? null,
          expiresAt: new Date(Date.now() + data.expires_in * 1000),
        },
        scopes: GBP_SCOPES,
      });
    }
  }

  if (!accounts.length) {
    accounts.push({
      platform: 'gbp',
      accountType: 'location',
      platformAccountId: accData.accounts?.[0]?.name || 'unknown',
      name: accData.accounts?.[0]?.accountName || 'Google Business Profile',
      profileUrl: null,
      tokens: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? null,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
      },
      scopes: GBP_SCOPES,
    });
  }
  return accounts;
}
