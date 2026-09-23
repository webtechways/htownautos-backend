import { socialFetch, SocialApiError } from '../http/social-http';
import type { SocialMedia } from '@prisma/client';
import type { PublishContext, PublishResult, SocialPublisher, PublishThreadItem } from './types';
import { mediaFor } from './types';

const THREADS_BASE = 'https://graph.threads.net/v1.0';
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_TRIES = 40;

interface ThreadsIdResponse {
  id: string;
}

async function threadsCall(path: string, params: Record<string, string>): Promise<ThreadsIdResponse> {
  const url = new URL(`${THREADS_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await socialFetch(url.toString(), { platform: 'threads', method: 'POST' });
  return (await res.json()) as ThreadsIdResponse;
}

async function pollUntilFinished(containerId: string, accessToken: string): Promise<void> {
  for (let i = 0; i < POLL_MAX_TRIES; i++) {
    const url = new URL(`${THREADS_BASE}/${containerId}`);
    url.searchParams.set('fields', 'status');
    url.searchParams.set('access_token', accessToken);
    const res = await socialFetch(url.toString(), { platform: 'threads' });
    const data = (await res.json()) as { status?: string };
    if (data.status === 'FINISHED') return;
    if (data.status === 'ERROR' || data.status === 'EXPIRED') {
      throw new SocialApiError({ platform: 'threads', httpStatus: 0, kind: 'VALIDATION', message: `Threads no pudo procesar el medio (${data.status})` });
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new SocialApiError({ platform: 'threads', httpStatus: 0, kind: 'TRANSIENT', message: 'Threads tardó demasiado en procesar el medio' });
}

async function createChildContainer(ctx: PublishContext, userId: string, media: SocialMedia): Promise<string> {
  const isVideo = media.kind === 'video';
  const params: Record<string, string> = { is_carousel_item: 'true', access_token: ctx.accessToken };
  params.media_type = isVideo ? 'VIDEO' : 'IMAGE';
  if (isVideo) params.video_url = await ctx.resolver.signedUrl(media);
  else params.image_url = await ctx.resolver.signedUrl(media);
  const created = await threadsCall(`/${userId}/threads`, params);
  if (isVideo) await pollUntilFinished(created.id, ctx.accessToken);
  return created.id;
}

/** Builds one container (text/image/video/carousel) and publishes it, optionally replying to `replyToId`. */
async function createAndPublish(
  ctx: PublishContext,
  userId: string,
  text: string,
  media: SocialMedia[],
  replyToId: string | null,
): Promise<PublishResult> {
  const base: Record<string, string> = { text, access_token: ctx.accessToken };
  if (replyToId) base.reply_to_id = replyToId;

  let containerId: string;
  if (media.length > 1) {
    const childIds = await Promise.all(media.map((m) => createChildContainer(ctx, userId, m)));
    const created = await threadsCall(`/${userId}/threads`, { ...base, media_type: 'CAROUSEL', children: childIds.join(',') });
    containerId = created.id;
  } else if (media.length === 1) {
    const item = media[0];
    const isVideo = item.kind === 'video';
    const params = { ...base, media_type: isVideo ? 'VIDEO' : 'IMAGE' } as Record<string, string>;
    if (isVideo) params.video_url = await ctx.resolver.signedUrl(item);
    else params.image_url = await ctx.resolver.signedUrl(item);
    const created = await threadsCall(`/${userId}/threads`, params);
    if (isVideo) await pollUntilFinished(created.id, ctx.accessToken);
    containerId = created.id;
  } else {
    const created = await threadsCall(`/${userId}/threads`, { ...base, media_type: 'TEXT' });
    containerId = created.id;
  }

  const published = await threadsCall(`/${userId}/threads_publish`, { creation_id: containerId, access_token: ctx.accessToken });
  return { externalId: published.id, externalUrl: null };
}

export const threadsPublisher: SocialPublisher = {
  async publish(ctx) {
    const userId = ctx.account.platformAccountId;
    const media = mediaFor(ctx, ctx.mediaIds);
    return createAndPublish(ctx, userId, ctx.content, media, null);
  },

  async publishThreadItem(ctx, chain, item: PublishThreadItem) {
    const userId = ctx.account.platformAccountId;
    const media = mediaFor(ctx, item.mediaIds);
    return createAndPublish(ctx, userId, item.content, media, chain.parent.externalId);
  },
};
