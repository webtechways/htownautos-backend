import { socialFetch, SocialApiError } from '../http/social-http';
import { iterateRangeChunks } from './chunk-source';
import { toBytes } from './bytes';
import type { PublishContext, PublishResult, SocialPublisher } from './types';
import { mediaFor } from './types';

const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';
const CHUNK_BYTES = 8 * 1024 * 1024; // multiple of 256KB, per Google's resumable upload requirement

export const youtubePublisher: SocialPublisher = {
  async publish(ctx) {
    const opts = ctx.options.youtube;
    if (!opts) throw new SocialApiError({ platform: 'youtube', httpStatus: 0, kind: 'VALIDATION', message: 'YouTube requiere título y configuración de privacidad' });

    const media = mediaFor(ctx, ctx.mediaIds).find((m) => m.kind === 'video');
    if (!media) throw new SocialApiError({ platform: 'youtube', httpStatus: 0, kind: 'VALIDATION', message: 'YouTube requiere un video' });

    const initUrl = new URL(UPLOAD_URL);
    initUrl.searchParams.set('uploadType', 'resumable');
    initUrl.searchParams.set('part', 'snippet,status');
    if (opts.notifySubscribers !== undefined) initUrl.searchParams.set('notifySubscribers', String(opts.notifySubscribers));

    const initRes = await socialFetch(initUrl.toString(), {
      platform: 'youtube',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Length': String(media.sizeBytes),
        'X-Upload-Content-Type': media.mimeType,
      },
      body: JSON.stringify({
        snippet: { title: opts.title, description: ctx.content, tags: opts.tags, categoryId: opts.categoryId },
        status: { privacyStatus: opts.privacy, selfDeclaredMadeForKids: opts.madeForKids },
      }),
    });
    const sessionUrl = initRes.headers.get('location');
    if (!sessionUrl) throw new SocialApiError({ platform: 'youtube', httpStatus: 0, kind: 'TRANSIENT', message: 'YouTube no devolvió una sesión de subida' });

    // Google's resumable protocol answers every non-final chunk with 308
    // "Resume Incomplete" — that's success here, not an error, so these PUTs
    // go through plain `fetch` rather than `socialFetch` (which treats any
    // non-2xx as a failure).
    const signedUrl = await ctx.resolver.signedUrl(media);
    let finalBody: { id: string } | null = null;
    for await (const chunk of iterateRangeChunks(signedUrl, media.sizeBytes, CHUNK_BYTES)) {
      const res = await fetch(sessionUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(chunk.buffer.length),
          'Content-Range': `bytes ${chunk.start}-${chunk.end}/${media.sizeBytes}`,
        },
        body: toBytes(chunk.buffer),
      });
      if (res.status === 308) continue;
      if (!res.ok) {
        throw new SocialApiError({ platform: 'youtube', httpStatus: res.status, kind: res.status >= 500 ? 'TRANSIENT' : 'VALIDATION', message: `YouTube respondió ${res.status} subiendo el video` });
      }
      finalBody = (await res.json()) as { id: string };
    }
    if (!finalBody) throw new SocialApiError({ platform: 'youtube', httpStatus: 0, kind: 'VALIDATION', message: 'El video no tiene contenido para subir' });

    return { externalId: finalBody.id, externalUrl: `https://youtu.be/${finalBody.id}` };
  },
};
