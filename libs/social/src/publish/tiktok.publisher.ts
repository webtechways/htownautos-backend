import { socialFetch, SocialApiError } from '../http/social-http';
import { iterateRangeChunks } from './chunk-source';
import { toBytes } from './bytes';
import type { PublishContext, PublishResult, SocialPublisher } from './types';
import { mediaFor } from './types';

const BASE = 'https://open.tiktokapis.com/v2/post/publish';
const VIDEO_CHUNK_BYTES = 10 * 1024 * 1024; // 10MB — within TikTok's 5MB–64MB per-chunk window
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_TRIES = 60;

function headers(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
}

interface CreatorInfo {
  privacy_level_options: string[];
  max_video_post_duration_sec: number;
}

async function queryCreatorInfo(accessToken: string): Promise<CreatorInfo> {
  const res = await socialFetch(`${BASE}/creator_info/query/`, { platform: 'tiktok', method: 'POST', headers: headers(accessToken) });
  const data = (await res.json()) as { data: CreatorInfo };
  return data.data;
}

async function pollStatus(accessToken: string, publishId: string): Promise<void> {
  for (let i = 0; i < POLL_MAX_TRIES; i++) {
    const res = await socialFetch(`${BASE}/status/fetch/`, {
      platform: 'tiktok',
      method: 'POST',
      headers: headers(accessToken),
      body: JSON.stringify({ publish_id: publishId }),
    });
    const data = (await res.json()) as { data?: { status: string; fail_reason?: string } };
    const status = data.data?.status;
    if (status === 'PUBLISH_COMPLETE' || status === 'SEND_TO_USER_INBOX') return;
    if (status === 'FAILED') {
      throw new SocialApiError({ platform: 'tiktok', httpStatus: 0, kind: 'VALIDATION', message: `TikTok rechazó la publicación: ${data.data?.fail_reason ?? 'desconocido'}` });
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new SocialApiError({ platform: 'tiktok', httpStatus: 0, kind: 'TRANSIENT', message: 'TikTok tardó demasiado en procesar la publicación' });
}

function postInfo(ctx: PublishContext): Record<string, unknown> {
  const opts = ctx.options.tiktok;
  if (!opts) {
    throw new SocialApiError({ platform: 'tiktok', httpStatus: 0, kind: 'VALIDATION', message: 'TikTok requiere privacyLevel y las casillas de divulgación de contenido comercial' });
  }
  return {
    title: opts.title ?? ctx.content,
    privacy_level: opts.privacyLevel,
    disable_comment: opts.disableComment,
    disable_duet: opts.disableDuet,
    disable_stitch: opts.disableStitch,
    brand_content_toggle: opts.brandContentToggle,
    brand_organic_toggle: opts.brandOrganicToggle,
    ...(opts.isAigc !== undefined ? { is_aigc: opts.isAigc } : {}),
  };
}

async function publishVideo(ctx: PublishContext): Promise<PublishResult> {
  const media = mediaFor(ctx, ctx.mediaIds).find((m) => m.kind === 'video');
  if (!media) throw new SocialApiError({ platform: 'tiktok', httpStatus: 0, kind: 'VALIDATION', message: 'TikTok requiere un video' });

  const info = await queryCreatorInfo(ctx.accessToken);
  const opts = ctx.options.tiktok!;
  if (!info.privacy_level_options.includes(opts.privacyLevel)) {
    throw new SocialApiError({ platform: 'tiktok', httpStatus: 0, kind: 'VALIDATION', message: `Esta cuenta de TikTok no permite privacyLevel=${opts.privacyLevel} (app sin auditar)` });
  }

  const chunkSize = Math.min(VIDEO_CHUNK_BYTES, media.sizeBytes);
  const totalChunks = Math.max(1, Math.ceil(media.sizeBytes / chunkSize));
  const initRes = await socialFetch(`${BASE}/video/init/`, {
    platform: 'tiktok',
    method: 'POST',
    headers: headers(ctx.accessToken),
    body: JSON.stringify({
      post_info: postInfo(ctx),
      source_info: { source: 'FILE_UPLOAD', video_size: media.sizeBytes, chunk_size: chunkSize, total_chunk_count: totalChunks },
    }),
  });
  const init = (await initRes.json()) as { data: { publish_id: string; upload_url: string } };

  const signedUrl = await ctx.resolver.signedUrl(media);
  for await (const chunk of iterateRangeChunks(signedUrl, media.sizeBytes, chunkSize)) {
    await socialFetch(init.data.upload_url, {
      platform: 'tiktok',
      method: 'PUT',
      headers: {
        'Content-Range': `bytes ${chunk.start}-${chunk.end}/${media.sizeBytes}`,
        'Content-Type': media.mimeType,
      },
      body: toBytes(chunk.buffer),
    });
  }

  await pollStatus(ctx.accessToken, init.data.publish_id);
  return { externalId: init.data.publish_id, externalUrl: null };
}

/** Photos pull directly from the signed URL — no chunked byte upload needed. */
async function publishPhoto(ctx: PublishContext): Promise<PublishResult> {
  const media = mediaFor(ctx, ctx.mediaIds).filter((m) => m.kind === 'image');
  if (media.length === 0) throw new SocialApiError({ platform: 'tiktok', httpStatus: 0, kind: 'VALIDATION', message: 'TikTok requiere al menos una foto' });

  const urls = await Promise.all(media.map((m) => ctx.resolver.signedUrl(m)));
  const initRes = await socialFetch(`${BASE}/content/init/`, {
    platform: 'tiktok',
    method: 'POST',
    headers: headers(ctx.accessToken),
    body: JSON.stringify({
      post_info: { ...postInfo(ctx), description: ctx.content },
      source_info: { source: 'PULL_FROM_URL', photo_images: urls, photo_cover_index: 0 },
      post_mode: 'DIRECT_POST',
      media_type: 'PHOTO',
    }),
  });
  const init = (await initRes.json()) as { data: { publish_id: string } };
  await pollStatus(ctx.accessToken, init.data.publish_id);
  return { externalId: init.data.publish_id, externalUrl: null };
}

export const tiktokPublisher: SocialPublisher = {
  async publish(ctx) {
    const media = mediaFor(ctx, ctx.mediaIds);
    const hasVideo = media.some((m) => m.kind === 'video');
    return hasVideo ? publishVideo(ctx) : publishPhoto(ctx);
  },
};
