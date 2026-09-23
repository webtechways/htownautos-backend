import type { SocialMedia } from '@prisma/client';
import { socialFetch, SocialApiError } from '../http/social-http';
import { toBytes } from '../publish/bytes';
import { MessagingError } from './types';
import type { SendMessageParams, SendMessageOutcome, SocialMessenger, WindowInfo } from './types';

const XRPC = 'https://bsky.social/xrpc';
/** Every chat.bsky.* call must be proxied to the chat service — see AT Proto's "Application Views" doc. */
const CHAT_PROXY_HEADER = { 'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat' };
const MAX_IMAGE_BYTES = 1_000_000;

/** Bluesky DMs have no time-window restriction. */
const OPEN_WINDOW: WindowInfo = { canReply: true, windowExpiresAt: null, replyRequiresTemplate: false };

async function getConvoId(accessToken: string, memberDid: string): Promise<string> {
  const url = new URL(`${XRPC}/chat.bsky.convo.getConvoForMembers`);
  url.searchParams.append('members', memberDid);
  const res = await socialFetch(url.toString(), {
    platform: 'bluesky',
    headers: { Authorization: `Bearer ${accessToken}`, ...CHAT_PROXY_HEADER },
  });
  const data = (await res.json()) as { convo: { id: string } };
  return data.convo.id;
}

async function uploadImageBlob(ctx: SendMessageParams['ctx'], media: SocialMedia): Promise<{ $type: string; ref: { $link: string }; mimeType: string; size: number }> {
  const buf = await ctx.resolver.fitUnder(media, MAX_IMAGE_BYTES);
  const res = await socialFetch(`${XRPC}/com.atproto.repo.uploadBlob`, {
    platform: 'bluesky',
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'image/jpeg' },
    body: toBytes(buf),
  });
  const data = (await res.json()) as { blob: { $type: string; ref: { $link: string }; mimeType: string; size: number } };
  return data.blob;
}

export const blueskyMessenger: SocialMessenger = {
  windowInfo: () => OPEN_WINDOW,

  async send(params: SendMessageParams): Promise<SendMessageOutcome> {
    const { ctx, recipientExternalId, text, media } = params;
    if (!text && !media?.length) {
      throw new MessagingError('NOT_SUPPORTED', 'Nada que enviar: falta texto o medios');
    }

    const convoId = await getConvoId(ctx.accessToken, recipientExternalId);

    const embed = media && media.length > 0
      ? { $type: 'app.bsky.embed.images', images: await Promise.all(media.slice(0, 4).map(async (m) => ({ image: await uploadImageBlob(ctx, m), alt: m.altText ?? '' }))) }
      : undefined;

    const res = await socialFetch(`${XRPC}/chat.bsky.convo.sendMessage`, {
      platform: 'bluesky',
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'application/json', ...CHAT_PROXY_HEADER },
      body: JSON.stringify({ convoId, message: { text: text ?? '', ...(embed ? { embed } : {}) } }),
    });
    const data = (await res.json()) as { id: string };
    if (!data.id) throw new SocialApiError({ platform: 'bluesky', httpStatus: 0, kind: 'UNKNOWN', message: 'Bluesky no devolvió un id de mensaje' });
    return { externalId: data.id, status: 'sent' };
  },
};
