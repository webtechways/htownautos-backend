import { socialFetch, SocialApiError } from '../../http/social-http';
import { graphUrl } from '../meta-graph';
import type { ConnectedAccount, RefreshedProfile } from '../types';

/** Facebook Page management + Messenger + webhook subscribe. */
export const FACEBOOK_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'pages_manage_metadata',
  'pages_messaging',
  'pages_read_user_content',
  'pages_manage_engagement',
  'read_insights',
  'public_profile',
];

/** Instagram Business/Creator accounts reached through a Facebook Page (Facebook Login flow). */
export const INSTAGRAM_FB_LOGIN_SCOPES = [
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_comments',
  'instagram_manage_messages',
  'pages_show_list',
  'pages_read_engagement',
  // Account + media insights (B7, CONTRACT.md §3.8).
  'instagram_manage_insights',
];

export function buildFacebookOAuthUrl(clientId: string, redirectUri: string, state: string, scopes: string[]): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes.join(','),
    state,
    response_type: 'code',
  });
  return `https://www.facebook.com/${process.env.META_GRAPH_VERSION || 'v23.0'}/dialog/oauth?${params.toString()}`;
}

async function exchangeCodeForUserToken(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<string> {
  const url = new URL(graphUrl('/oauth/access_token'));
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('client_secret', clientSecret);
  url.searchParams.set('code', code);
  url.searchParams.set('redirect_uri', redirectUri);
  const res = await socialFetch(url.toString(), { platform: 'facebook' });
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function exchangeLongLivedToken(clientId: string, clientSecret: string, shortLivedToken: string): Promise<string> {
  const url = new URL(graphUrl('/oauth/access_token'));
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('client_secret', clientSecret);
  url.searchParams.set('fb_exchange_token', shortLivedToken);
  const res = await socialFetch(url.toString(), { platform: 'facebook' });
  const data = (await res.json()) as { access_token: string };
  return data.access_token || shortLivedToken;
}

interface FbPage {
  id: string;
  name: string;
  access_token: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id: string; name?: string; username?: string; profile_picture_url?: string };
}

/**
 * Exchanges the OAuth `code` and returns every Facebook Page the user
 * manages, each as its own `ConnectedAccount` with a page-scoped token
 * (page tokens don't expire while the user token they came from is valid).
 * `subscribeWebhook: true` tells the caller to subscribe each page to the
 * app webhook right after persisting it.
 */
export async function connectFacebookPages(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<ConnectedAccount[]> {
  const shortLived = await exchangeCodeForUserToken(clientId, clientSecret, code, redirectUri);
  const userToken = await exchangeLongLivedToken(clientId, clientSecret, shortLived);

  const url = new URL(graphUrl('/me/accounts'));
  url.searchParams.set('fields', 'id,name,picture{url},access_token');
  url.searchParams.set('access_token', userToken);
  const res = await socialFetch(url.toString(), { platform: 'facebook' });
  const data = (await res.json()) as { data: FbPage[] };

  return (data.data || []).map((page) => ({
    platform: 'facebook',
    accountType: 'page',
    platformAccountId: page.id,
    name: page.name,
    avatarUrl: page.picture?.data?.url ?? null,
    profileUrl: `https://facebook.com/${page.id}`,
    tokens: { accessToken: page.access_token, expiresAt: null },
    scopes: FACEBOOK_SCOPES,
    subscribeWebhook: true,
  }));
}

/**
 * Same OAuth exchange, but returns the Instagram Business/Creator account
 * linked to each Facebook Page (Instagram-via-Facebook-Login path). The
 * Instagram account publishes with the Page's access token.
 */
export async function connectInstagramViaFacebook(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<ConnectedAccount[]> {
  const shortLived = await exchangeCodeForUserToken(clientId, clientSecret, code, redirectUri);
  const userToken = await exchangeLongLivedToken(clientId, clientSecret, shortLived);

  const url = new URL(graphUrl('/me/accounts'));
  url.searchParams.set('fields', 'id,name,instagram_business_account{id,name,username,profile_picture_url}');
  url.searchParams.set('access_token', userToken);
  const res = await socialFetch(url.toString(), { platform: 'instagram' });
  const data = (await res.json()) as { data: FbPage[] };

  const accounts: ConnectedAccount[] = [];
  for (const page of data.data || []) {
    const ig = page.instagram_business_account;
    if (!ig) continue;
    accounts.push({
      platform: 'instagram',
      accountType: 'business',
      platformAccountId: ig.id,
      name: ig.name || ig.username || 'Instagram',
      username: ig.username ?? null,
      avatarUrl: ig.profile_picture_url ?? null,
      profileUrl: ig.username ? `https://instagram.com/${ig.username}` : null,
      tokens: { accessToken: page.access_token, expiresAt: null },
      extraSecrets: { fbPageId: page.id },
      scopes: INSTAGRAM_FB_LOGIN_SCOPES,
      subscribeWebhook: false,
    });
  }
  if (!accounts.length) {
    throw new SocialApiError({
      platform: 'instagram',
      httpStatus: 0,
      kind: 'VALIDATION',
      message: 'Ninguna de tus páginas de Facebook tiene una cuenta de Instagram Business/Creator vinculada',
    });
  }
  return accounts;
}

/**
 * Subscribes a Page to the app's webhook (`feed`, `messages`, `message_echoes`)
 * per CONTRACT.md §3.1. Called by the service right after a Facebook Page
 * connects (or an Instagram-via-Facebook account, over the same page token).
 */
/** Re-fetches a connected Page's own name/picture with its own page token — same fields `connectFacebookPages` reads off `/me/accounts`, scoped to one page for `refresh()`. */
export async function fetchFacebookPageProfile(pageId: string, pageAccessToken: string): Promise<RefreshedProfile> {
  const url = new URL(graphUrl(`/${pageId}`));
  url.searchParams.set('fields', 'name,picture{url}');
  url.searchParams.set('access_token', pageAccessToken);
  const res = await socialFetch(url.toString(), { platform: 'facebook' });
  const page = (await res.json()) as { name: string; picture?: { data?: { url?: string } } };
  return { name: page.name, username: null, avatarUrl: page.picture?.data?.url ?? null, profileUrl: `https://facebook.com/${pageId}` };
}

/** Re-fetches an Instagram-via-Facebook-Login account's profile with the page token that publishes for it — same fields `connectInstagramViaFacebook` reads off `instagram_business_account`. */
export async function fetchInstagramViaFacebookProfile(igId: string, pageAccessToken: string): Promise<RefreshedProfile> {
  const url = new URL(graphUrl(`/${igId}`));
  url.searchParams.set('fields', 'name,username,profile_picture_url');
  url.searchParams.set('access_token', pageAccessToken);
  const res = await socialFetch(url.toString(), { platform: 'instagram' });
  const ig = (await res.json()) as { name?: string; username?: string; profile_picture_url?: string };
  return {
    name: ig.name || ig.username || 'Instagram',
    username: ig.username ?? null,
    avatarUrl: ig.profile_picture_url ?? null,
    profileUrl: ig.username ? `https://instagram.com/${ig.username}` : null,
  };
}

export async function subscribeFacebookPageWebhook(pageId: string, pageAccessToken: string): Promise<void> {
  const url = new URL(graphUrl(`/${pageId}/subscribed_apps`));
  url.searchParams.set('subscribed_fields', 'feed,messages,message_echoes');
  url.searchParams.set('access_token', pageAccessToken);
  await socialFetch(url.toString(), { platform: 'facebook', method: 'POST' });
}
