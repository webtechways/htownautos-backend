import { socialFetch, SocialApiError } from '../http/social-http';
import { toBytes } from '../publish/bytes';
import { MessagingError } from './types';
import type { SendMessageParams, SendMessageOutcome, SocialMessenger, WindowInfo } from './types';

const DM_URL = (participantId: string) => `https://api.x.com/2/dm_conversations/with/${participantId}/messages`;
const MEDIA_UPLOAD_URL = 'https://api.x.com/2/media/upload';

/** X DMs have no 24h/template restriction in the API — always open once a conversation exists. */
const OPEN_WINDOW: WindowInfo = { canReply: true, windowExpiresAt: null, replyRequiresTemplate: false };

function mediaCategoryFor(mimeType: string): string {
  if (mimeType.startsWith('video/')) return 'dm_video';
  if (mimeType === 'image/gif') return 'dm_gif';
  return 'dm_image';
}

/** Single-shot upload (INIT+APPEND+FINALIZE in sequence) — fine for DM attachments, which are small; no chunking/polling like the publisher's video path. */
async function uploadMedia(accessToken: string, buffer: Buffer, mimeType: string): Promise<string> {
  const authHeaders = { Authorization: `Bearer ${accessToken}` };

  const initForm = new FormData();
  initForm.set('command', 'INIT');
  initForm.set('total_bytes', String(buffer.length));
  initForm.set('media_type', mimeType);
  initForm.set('media_category', mediaCategoryFor(mimeType));
  const initRes = await socialFetch(MEDIA_UPLOAD_URL, { platform: 'x', method: 'POST', headers: authHeaders, body: initForm });
  const initData = (await initRes.json()) as { data?: { id: string } };
  const mediaId = initData.data?.id;
  if (!mediaId) throw new SocialApiError({ platform: 'x', httpStatus: 0, kind: 'TRANSIENT', message: 'X no devolvió un media_id en INIT' });

  const appendForm = new FormData();
  appendForm.set('command', 'APPEND');
  appendForm.set('media_id', mediaId);
  appendForm.set('segment_index', '0');
  appendForm.set('media', new Blob([toBytes(buffer)]));
  await socialFetch(MEDIA_UPLOAD_URL, { platform: 'x', method: 'POST', headers: authHeaders, body: appendForm });

  const finalizeForm = new FormData();
  finalizeForm.set('command', 'FINALIZE');
  finalizeForm.set('media_id', mediaId);
  await socialFetch(MEDIA_UPLOAD_URL, { platform: 'x', method: 'POST', headers: authHeaders, body: finalizeForm });

  return mediaId;
}

export const xMessenger: SocialMessenger = {
  windowInfo: () => OPEN_WINDOW,

  async send(params: SendMessageParams): Promise<SendMessageOutcome> {
    const { ctx, recipientExternalId, text, media } = params;
    if (!text && !media?.length) {
      throw new MessagingError('NOT_SUPPORTED', 'Nada que enviar: falta texto o medios');
    }

    const mediaIds = await Promise.all(
      (media ?? []).map(async (item) => uploadMedia(ctx.accessToken, await ctx.resolver.buffer(item), item.mimeType)),
    );

    const body: Record<string, unknown> = {};
    if (text) body.text = text;
    if (mediaIds.length > 0) body.attachments = mediaIds.map((id) => ({ media_id: id }));

    const res = await socialFetch(DM_URL(recipientExternalId), {
      platform: 'x',
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { data: { dm_conversation_id: string; dm_event_id: string } };
    return { externalId: data.data.dm_event_id, status: 'sent' };
  },
};
