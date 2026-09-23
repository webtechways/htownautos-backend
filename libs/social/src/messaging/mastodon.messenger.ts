import type { SocialMedia } from '@prisma/client';
import { socialFetch, SocialApiError } from '../http/social-http';
import { toBytes } from '../publish/bytes';
import { MessagingError } from './types';
import type { MessagingContext, SendMessageParams, SendMessageOutcome, SocialMessenger, WindowInfo } from './types';

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_TRIES = 30;

/** Mastodon has no true 1:1 DM — a "direct message" is a status visibility=direct mentioning the recipient. No time window. */
const OPEN_WINDOW: WindowInfo = { canReply: true, windowExpiresAt: null, replyRequiresTemplate: false };

function instanceOf(ctx: MessagingContext): string {
  const host = ctx.secrets.instance as string | undefined;
  if (!host) throw new SocialApiError({ platform: 'mastodon', httpStatus: 0, kind: 'NOT_CONFIGURED', message: 'Cuenta de Mastodon sin instancia guardada — reconectar' });
  return host;
}

async function uploadMedia(ctx: MessagingContext, host: string, media: SocialMedia): Promise<string> {
  const buf = await ctx.resolver.buffer(media);
  const form = new FormData();
  form.set('file', new Blob([toBytes(buf)], { type: media.mimeType }), media.fileName ?? media.id);
  if (media.altText) form.set('description', media.altText);

  const res = await socialFetch(`https://${host}/api/v2/media`, {
    platform: 'mastodon',
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.accessToken}` },
    body: form,
  });
  const data = (await res.json()) as { id: string; url?: string | null };
  if (data.url) return data.id;

  for (let i = 0; i < POLL_MAX_TRIES; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const statusRes = await socialFetch(`https://${host}/api/v1/media/${data.id}`, {
      platform: 'mastodon',
      headers: { Authorization: `Bearer ${ctx.accessToken}` },
    });
    if (statusRes.status === 200) {
      const statusData = (await statusRes.json()) as { url?: string | null };
      if (statusData.url) return data.id;
    }
  }
  throw new SocialApiError({ platform: 'mastodon', httpStatus: 0, kind: 'TRANSIENT', message: 'Mastodon tardó demasiado en procesar el medio' });
}

export const mastodonMessenger: SocialMessenger = {
  windowInfo: () => OPEN_WINDOW,

  async send(params: SendMessageParams): Promise<SendMessageOutcome> {
    const { ctx, recipientExternalId, text, media } = params;
    // `recipientExternalId` is the conversation's contact handle (`@user@instance` or local `@user`) — required to @-mention in the status body.
    if (!recipientExternalId.trim()) {
      throw new MessagingError('NOT_SUPPORTED', 'Falta el handle de Mastodon del contacto para poder mencionarlo');
    }
    if (!text && !media?.length) {
      throw new MessagingError('NOT_SUPPORTED', 'Nada que enviar: falta texto o medios');
    }

    const host = instanceOf(ctx);
    const mediaIds = await Promise.all((media ?? []).map((m) => uploadMedia(ctx, host, m)));
    const mention = recipientExternalId.startsWith('@') ? recipientExternalId : `@${recipientExternalId}`;
    const status = text ? `${mention} ${text}` : mention;

    const res = await socialFetch(`https://${host}/api/v1/statuses`, {
      platform: 'mastodon',
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, media_ids: mediaIds, visibility: 'direct' }),
    });
    const data = (await res.json()) as { id: string };
    return { externalId: data.id, status: 'sent' };
  },
};
