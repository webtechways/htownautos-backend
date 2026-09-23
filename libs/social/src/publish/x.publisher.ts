import { socialFetch, SocialApiError } from '../http/social-http';
import { iterateRangeChunks } from './chunk-source';
import { toBytes } from './bytes';
import type { SocialMedia } from '@prisma/client';
import type { PublishContext, PublishResult, SocialPublisher, PublishThreadItem } from './types';
import { mediaFor } from './types';

const MEDIA_UPLOAD_URL = 'https://api.x.com/2/media/upload';
const TWEETS_URL = 'https://api.x.com/2/tweets';
const VIDEO_CHUNK_BYTES = 4 * 1024 * 1024; // 4MB, X's documented APPEND chunk size
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_TRIES = 60;

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

function mediaCategoryFor(media: SocialMedia): string {
  if (media.kind === 'video') return 'tweet_video';
  if (media.kind === 'gif') return 'tweet_gif';
  return 'tweet_image';
}

async function initUpload(accessToken: string, media: SocialMedia): Promise<string> {
  const form = new FormData();
  form.set('command', 'INIT');
  form.set('total_bytes', String(media.sizeBytes));
  form.set('media_type', media.mimeType);
  form.set('media_category', mediaCategoryFor(media));
  const res = await socialFetch(MEDIA_UPLOAD_URL, { platform: 'x', method: 'POST', headers: authHeaders(accessToken), body: form });
  const data = (await res.json()) as { data?: { id: string } };
  if (!data.data?.id) throw new SocialApiError({ platform: 'x', httpStatus: 0, kind: 'TRANSIENT', message: 'X no devolvió un media_id en INIT' });
  return data.data.id;
}

async function appendChunk(accessToken: string, mediaId: string, segmentIndex: number, chunk: Buffer): Promise<void> {
  const form = new FormData();
  form.set('command', 'APPEND');
  form.set('media_id', mediaId);
  form.set('segment_index', String(segmentIndex));
  form.set('media', new Blob([toBytes(chunk)]));
  await socialFetch(MEDIA_UPLOAD_URL, { platform: 'x', method: 'POST', headers: authHeaders(accessToken), body: form });
}

async function finalizeUpload(accessToken: string, mediaId: string): Promise<void> {
  const form = new FormData();
  form.set('command', 'FINALIZE');
  form.set('media_id', mediaId);
  const res = await socialFetch(MEDIA_UPLOAD_URL, { platform: 'x', method: 'POST', headers: authHeaders(accessToken), body: form });
  const data = (await res.json()) as { data?: { processing_info?: { state: string; check_after_secs?: number } } };
  const info = data.data?.processing_info;
  if (!info || info.state === 'succeeded') return;
  await pollProcessing(accessToken, mediaId);
}

async function pollProcessing(accessToken: string, mediaId: string): Promise<void> {
  for (let i = 0; i < POLL_MAX_TRIES; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const url = new URL(MEDIA_UPLOAD_URL);
    url.searchParams.set('command', 'STATUS');
    url.searchParams.set('media_id', mediaId);
    const res = await socialFetch(url.toString(), { platform: 'x', headers: authHeaders(accessToken) });
    const data = (await res.json()) as { data?: { processing_info?: { state: string } } };
    const state = data.data?.processing_info?.state;
    if (state === 'succeeded') return;
    if (state === 'failed') throw new SocialApiError({ platform: 'x', httpStatus: 0, kind: 'VALIDATION', message: 'X no pudo procesar el medio subido' });
  }
  throw new SocialApiError({ platform: 'x', httpStatus: 0, kind: 'TRANSIENT', message: 'X tardó demasiado en procesar el medio' });
}

/** Uploads one media item via chunked INIT/APPEND/FINALIZE, streaming video in 4MB Range reads (never the whole file in memory). */
async function uploadMedia(ctx: PublishContext, media: SocialMedia): Promise<string> {
  const mediaId = await initUpload(ctx.accessToken, media);

  if (media.kind === 'video' || media.kind === 'gif') {
    const signedUrl = await ctx.resolver.signedUrl(media);
    let segment = 0;
    for await (const chunk of iterateRangeChunks(signedUrl, media.sizeBytes, VIDEO_CHUNK_BYTES)) {
      await appendChunk(ctx.accessToken, mediaId, segment, chunk.buffer);
      segment++;
    }
  } else {
    const buf = await ctx.resolver.buffer(media);
    await appendChunk(ctx.accessToken, mediaId, 0, buf);
  }

  await finalizeUpload(ctx.accessToken, mediaId);
  return mediaId;
}

async function postTweet(ctx: PublishContext, text: string, mediaIds: string[], inReplyToTweetId: string | null): Promise<PublishResult> {
  const body: Record<string, unknown> = { text };
  if (mediaIds.length > 0) body.media = { media_ids: mediaIds };
  if (inReplyToTweetId) body.reply = { in_reply_to_tweet_id: inReplyToTweetId };
  else if (ctx.options.x?.replySettings) body.reply_settings = ctx.options.x.replySettings;

  const res = await socialFetch(TWEETS_URL, {
    platform: 'x',
    method: 'POST',
    headers: { ...authHeaders(ctx.accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { data: { id: string } };
  const handle = ctx.account.username ?? ctx.account.platformAccountId;
  return { externalId: data.data.id, externalUrl: `https://x.com/${handle}/status/${data.data.id}` };
}

export const xPublisher: SocialPublisher = {
  async publish(ctx) {
    const media = mediaFor(ctx, ctx.mediaIds);
    const mediaIds = await Promise.all(media.map((m) => uploadMedia(ctx, m)));
    return postTweet(ctx, ctx.content, mediaIds, null);
  },

  async publishThreadItem(ctx, chain, item: PublishThreadItem) {
    const media = mediaFor(ctx, item.mediaIds);
    const mediaIds = await Promise.all(media.map((m) => uploadMedia(ctx, m)));
    return postTweet(ctx, item.content, mediaIds, chain.parent.externalId);
  },
};
