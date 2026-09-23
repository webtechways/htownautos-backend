import { socialFetch, SocialApiError } from '../http/social-http';
import type { SocialMedia } from '@prisma/client';
import { toBytes } from './bytes';
import type { PublishContext, PublishResult, SocialPublisher } from './types';
import { mediaFor } from './types';

const BASE = 'https://api.pinterest.com/v5';
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_TRIES = 60;

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
}

interface RegisterMediaResponse {
  media_id: string;
  upload_url: string;
  upload_parameters: Record<string, string>;
}

async function uploadVideoAndWait(ctx: PublishContext, media: SocialMedia): Promise<string> {
  const registerRes = await socialFetch(`${BASE}/media`, {
    platform: 'pinterest',
    method: 'POST',
    headers: authHeaders(ctx.accessToken),
    body: JSON.stringify({ media_type: 'video' }),
  });
  const registered = (await registerRes.json()) as RegisterMediaResponse;

  const buf = await ctx.resolver.buffer(media);
  const form = new FormData();
  for (const [k, v] of Object.entries(registered.upload_parameters)) form.set(k, v);
  form.set('file', new Blob([toBytes(buf)]));
  await socialFetch(registered.upload_url, { platform: 'pinterest', method: 'POST', body: form });

  for (let i = 0; i < POLL_MAX_TRIES; i++) {
    const statusRes = await socialFetch(`${BASE}/media/${registered.media_id}`, { platform: 'pinterest', headers: authHeaders(ctx.accessToken) });
    const status = (await statusRes.json()) as { status: string };
    if (status.status === 'succeeded') return registered.media_id;
    if (status.status === 'failed') throw new SocialApiError({ platform: 'pinterest', httpStatus: 0, kind: 'VALIDATION', message: 'Pinterest no pudo procesar el video' });
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new SocialApiError({ platform: 'pinterest', httpStatus: 0, kind: 'TRANSIENT', message: 'Pinterest tardó demasiado en procesar el video' });
}

export const pinterestPublisher: SocialPublisher = {
  async publish(ctx) {
    const opts = ctx.options.pinterest;
    if (!opts?.boardId) throw new SocialApiError({ platform: 'pinterest', httpStatus: 0, kind: 'VALIDATION', message: 'Pinterest requiere un tablero (boardId)' });

    const media = mediaFor(ctx, ctx.mediaIds);
    const video = media.find((m) => m.kind === 'video');

    let mediaSource: Record<string, unknown>;
    if (video) {
      const mediaId = await uploadVideoAndWait(ctx, video);
      const coverUrl = await ctx.resolver.signedUrl(video.thumbnailKey ? { key: video.thumbnailKey } : video);
      mediaSource = { source_type: 'video_id', media_id: mediaId, cover_image_url: coverUrl };
    } else if (media.length > 1) {
      const urls = await Promise.all(media.map((m) => ctx.resolver.signedUrl(m)));
      mediaSource = { source_type: 'multiple_image_urls', items: urls.map((url) => ({ url })) };
    } else if (media.length === 1) {
      mediaSource = { source_type: 'image_url', url: await ctx.resolver.signedUrl(media[0]) };
    } else {
      throw new SocialApiError({ platform: 'pinterest', httpStatus: 0, kind: 'VALIDATION', message: 'Pinterest requiere al menos una imagen o video' });
    }

    const res = await socialFetch(`${BASE}/pins`, {
      platform: 'pinterest',
      method: 'POST',
      headers: authHeaders(ctx.accessToken),
      body: JSON.stringify({
        board_id: opts.boardId,
        title: opts.title,
        description: ctx.content,
        link: opts.link,
        media_source: mediaSource,
      }),
    });
    const data = (await res.json()) as { id: string };
    return { externalId: data.id, externalUrl: `https://pinterest.com/pin/${data.id}` };
  },
};
