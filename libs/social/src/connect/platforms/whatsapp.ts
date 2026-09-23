import { socialFetch, SocialApiError } from '../../http/social-http';
import { graphUrl } from '../meta-graph';
import type { ConnectedAccount, RefreshedProfile } from '../types';

/**
 * WhatsApp Cloud API via Embedded Signup — no separate OAuth redirect: the
 * frontend runs Meta's JS SDK popup (`FB.login` with the WhatsApp config,
 * `WHATSAPP_CONFIG_ID`) and hands us the resulting `code` plus the
 * `waba_id`/`phone_number_id` it read off the `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`
 * event payload.
 */
export async function connectWhatsAppEmbedded(
  appId: string,
  appSecret: string,
  code: string,
  wabaId: string,
  phoneNumberId: string,
): Promise<ConnectedAccount[]> {
  const tokenUrl = new URL(graphUrl('/oauth/access_token'));
  tokenUrl.searchParams.set('client_id', appId);
  tokenUrl.searchParams.set('client_secret', appSecret);
  tokenUrl.searchParams.set('code', code);
  const tokenRes = await socialFetch(tokenUrl.toString(), { platform: 'whatsapp' });
  const tokenData = (await tokenRes.json()) as { access_token: string };

  return finalizeWhatsAppConnect(tokenData.access_token, wabaId, phoneNumberId, true);
}

/** Admin-only fallback: the token is typed in by hand (system user token from Meta Business Settings). */
export async function connectWhatsAppManual(
  wabaId: string,
  phoneNumberId: string,
  accessToken: string,
): Promise<ConnectedAccount[]> {
  return finalizeWhatsAppConnect(accessToken, wabaId, phoneNumberId, false);
}

interface WhatsAppPhoneNumber {
  display_phone_number: string;
  verified_name: string;
}

async function finalizeWhatsAppConnect(
  accessToken: string,
  wabaId: string,
  phoneNumberId: string,
  subscribeApp: boolean,
): Promise<ConnectedAccount[]> {
  const infoUrl = new URL(graphUrl(`/${phoneNumberId}`));
  infoUrl.searchParams.set('fields', 'display_phone_number,verified_name');
  infoUrl.searchParams.set('access_token', accessToken);
  const infoRes = await socialFetch(infoUrl.toString(), { platform: 'whatsapp' });
  const info = (await infoRes.json()) as WhatsAppPhoneNumber;
  if (!info.display_phone_number) {
    throw new SocialApiError({ platform: 'whatsapp', httpStatus: 0, kind: 'VALIDATION', message: 'No se pudo verificar el número de WhatsApp' });
  }

  if (subscribeApp) {
    const subUrl = new URL(graphUrl(`/${wabaId}/subscribed_apps`));
    subUrl.searchParams.set('access_token', accessToken);
    await socialFetch(subUrl.toString(), { platform: 'whatsapp', method: 'POST' });
  }

  return [
    {
      platform: 'whatsapp',
      accountType: 'phone_number',
      platformAccountId: phoneNumberId,
      name: info.verified_name || info.display_phone_number,
      username: info.display_phone_number,
      profileUrl: null,
      tokens: { accessToken, expiresAt: null },
      extraSecrets: { wabaId, phoneNumberId },
      scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'],
    },
  ];
}

/** Re-fetches the phone number's own display name/number — same fields `finalizeWhatsAppConnect` reads, used by `refresh()`. */
export async function fetchWhatsAppProfile(phoneNumberId: string, accessToken: string): Promise<RefreshedProfile> {
  const url = new URL(graphUrl(`/${phoneNumberId}`));
  url.searchParams.set('fields', 'display_phone_number,verified_name');
  url.searchParams.set('access_token', accessToken);
  const res = await socialFetch(url.toString(), { platform: 'whatsapp' });
  const info = (await res.json()) as WhatsAppPhoneNumber;
  return { name: info.verified_name || info.display_phone_number, username: info.display_phone_number, avatarUrl: null, profileUrl: null };
}

/** GET the phone number as a lightweight validation before persisting a manual connect. */
export async function validateWhatsAppToken(phoneNumberId: string, accessToken: string): Promise<boolean> {
  try {
    const url = new URL(graphUrl(`/${phoneNumberId}`));
    url.searchParams.set('fields', 'display_phone_number');
    url.searchParams.set('access_token', accessToken);
    await socialFetch(url.toString(), { platform: 'whatsapp' });
    return true;
  } catch {
    return false;
  }
}
