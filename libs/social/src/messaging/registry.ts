import type { InboxChannel } from '../types';
import type { SocialMessenger } from './types';
import { messengerMessenger, instagramMessenger } from './meta-dm.messenger';
import { whatsappMessenger } from './whatsapp.messenger';
import { xMessenger } from './x.messenger';
import { blueskyMessenger } from './bluesky.messenger';
import { mastodonMessenger } from './mastodon.messenger';

/** Every social-DM channel that has a `SocialMessenger` adapter — SMS has none (handled directly by `SmsService`/Twilio). */
export const MESSENGERS: Partial<Record<InboxChannel, SocialMessenger>> = {
  messenger: messengerMessenger,
  instagram: instagramMessenger,
  whatsapp: whatsappMessenger,
  x: xMessenger,
  bluesky: blueskyMessenger,
  mastodon: mastodonMessenger,
};

export function messengerFor(channel: InboxChannel): SocialMessenger | null {
  return MESSENGERS[channel] ?? null;
}
