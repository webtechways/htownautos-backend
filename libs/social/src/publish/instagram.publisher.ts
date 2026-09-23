import { socialFetch, SocialApiError } from '../http/social-http';
import { graphUrl } from '../connect/meta-graph';
import type { SocialMedia } from '@prisma/client';
import type { PublishContext, PublishResult, SocialPublisher } from './types';
import { mediaFor } from './types';

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_TRIES = 40; // ~2 minutes

interface GraphIdResponse {
  id: string;
}

async function graphCall(path: string, params: Record<string, string>): Promise<GraphIdResponse> {
  const url = new URL(graphUrl(path));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await socialFetch(url.toString(), { platform: 'instagram', method: 'POST' });
  return (await res.json()) as GraphIdResponse;
}

/** Instagram only fetches `image_url` for JPEG reliably — re-encode anything else. */
async function imageUrlFor(ctx: PublishContext, media: SocialMedia): Promise<string> {
  if (media.mimeType === 'image/jpeg') return ctx.resolver.signedUrl(media);
  const jpeg = await ctx.resolver.toJpeg(media);
  return ctx.reuploadTemp(jpeg, 'jpg', 'image/jpeg');
}

async function pollUntilFinished(containerId: string, accessToken: string): Promise<void> {
  for (let i = 0; i < POLL_MAX_TRIES; i++) {
    const url = new URL(graphUrl(`/${containerId}`));
    url.searchParams.set('fields', 'status_code');
    url.searchParams.set('access_token', accessToken);
    const res = await socialFetch(url.toString(), { platform: 'instagram' });
    const data = (await res.json()) as { status_code?: string };
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR' || data.status_code === 'EXPIRED') {
      throw new SocialApiError({ platform: 'instagram', httpStatus: 0, kind: 'VALIDATION', message: `Instagram no pudo procesar el medio (${data.status_code})` });
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new SocialApiError({ platform: 'instagram', httpStatus: 0, kind: 'TRANSIENT', message: 'Instagram tardó demasiado en procesar el medio' });
}

async function createChildContainer(ctx: PublishContext, igId: string, media: SocialMedia): Promise<string> {
  const isVideo = media.kind === 'video';
  const params: Record<string, string> = { is_carousel_item: 'true', access_token: ctx.accessToken };
  if (isVideo) {
    params.video_url = await ctx.resolver.signedUrl(media);
    params.media_type = 'VIDEO';
  } else {
    params.image_url = await imageUrlFor(ctx, media);
  }
  const created = await graphCall(`/${igId}/media`, params);
  if (isVideo) await pollUntilFinished(created.id, ctx.accessToken);
  return created.id;
}

export const instagramPublisher: SocialPublisher = {
  async publish(ctx) {
    const igId = ctx.account.platformAccountId;
    const postType = ctx.options.instagram?.postType ?? 'post';
    const media = mediaFor(ctx, ctx.mediaIds);

    if (media.length === 0) {
      throw new SocialApiError({ platform: 'instagram', httpStatus: 0, kind: 'VALIDATION', message: 'Instagram requiere al menos un medio' });
    }

    let containerId: string;

    if (postType === 'story') {
      const item = media[0];
      const params: Record<string, string> = { media_type: 'STORIES', access_token: ctx.accessToken };
      if (item.kind === 'video') params.video_url = await ctx.resolver.signedUrl(item);
      else params.image_url = await imageUrlFor(ctx, item);
      const created = await graphCall(`/${igId}/media`, params);
      if (item.kind === 'video') await pollUntilFinished(created.id, ctx.accessToken);
      containerId = created.id;
    } else if (postType === 'reel') {
      const item = media.find((m) => m.kind === 'video');
      if (!item) throw new SocialApiError({ platform: 'instagram', httpStatus: 0, kind: 'VALIDATION', message: 'Un reel de Instagram necesita un video' });
      const params: Record<string, string> = {
        media_type: 'REELS',
        video_url: await ctx.resolver.signedUrl(item),
        caption: ctx.content,
        access_token: ctx.accessToken,
      };
      if (ctx.options.instagram?.shareReelToFeed !== undefined) params.share_to_feed = String(ctx.options.instagram.shareReelToFeed);
      const created = await graphCall(`/${igId}/media`, params);
      await pollUntilFinished(created.id, ctx.accessToken);
      containerId = created.id;
    } else if (media.length > 1) {
      const childIds = await Promise.all(media.map((m) => createChildContainer(ctx, igId, m)));
      const created = await graphCall(`/${igId}/media`, {
        media_type: 'CAROUSEL',
        children: childIds.join(','),
        caption: ctx.content,
        access_token: ctx.accessToken,
      });
      containerId = created.id;
    } else {
      const item = media[0];
      const params: Record<string, string> = { caption: ctx.content, access_token: ctx.accessToken };
      if (item.kind === 'video') {
        params.video_url = await ctx.resolver.signedUrl(item);
        params.media_type = 'VIDEO';
      } else {
        params.image_url = await imageUrlFor(ctx, item);
      }
      const created = await graphCall(`/${igId}/media`, params);
      if (item.kind === 'video') await pollUntilFinished(created.id, ctx.accessToken);
      containerId = created.id;
    }

    const published = await graphCall(`/${igId}/media_publish`, { creation_id: containerId, access_token: ctx.accessToken });
    return { externalId: published.id, externalUrl: null };
  },

  async postFirstComment(ctx, parentExternalId, comment) {
    await graphCall(`/${parentExternalId}/comments`, { message: comment, access_token: ctx.accessToken });
  },
};
