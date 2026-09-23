import { socialFetch, SocialApiError } from '../http/social-http';
import { graphUrl } from '../connect/meta-graph';
import type { PublishContext, PublishResult, SocialPublisher } from './types';
import { mediaFor } from './types';

interface GraphIdResponse {
  id: string;
  post_id?: string;
}

async function graphPost(path: string, params: Record<string, string>, platform: 'facebook' = 'facebook'): Promise<GraphIdResponse> {
  const url = new URL(graphUrl(path));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await socialFetch(url.toString(), { platform, method: 'POST' });
  return (await res.json()) as GraphIdResponse;
}

/** Uploads one photo unpublished (so it can be attached to a multi-photo feed post) and returns its media fbid. */
async function uploadUnpublishedPhoto(pageId: string, accessToken: string, photoUrl: string): Promise<string> {
  const data = await graphPost(`/${pageId}/photos`, { url: photoUrl, published: 'false', access_token: accessToken });
  return data.id;
}

async function publishFeedPost(ctx: PublishContext, pageId: string): Promise<PublishResult> {
  const media = mediaFor(ctx, ctx.mediaIds);
  const images = media.filter((m) => m.kind === 'image');
  const videos = media.filter((m) => m.kind === 'video' || m.kind === 'gif');

  if (videos.length > 0) {
    const videoUrl = await ctx.resolver.signedUrl(videos[0]);
    const data = await graphPost(`/${pageId}/videos`, {
      file_url: videoUrl,
      description: ctx.content,
      access_token: ctx.accessToken,
    });
    return { externalId: data.id, externalUrl: `https://facebook.com/${data.id}` };
  }

  if (images.length > 0) {
    if (images.length === 1) {
      const photoUrl = await ctx.resolver.signedUrl(images[0]);
      const data = await graphPost(`/${pageId}/photos`, { url: photoUrl, caption: ctx.content, access_token: ctx.accessToken });
      return { externalId: data.post_id ?? data.id, externalUrl: `https://facebook.com/${data.post_id ?? data.id}` };
    }
    const fbids = await Promise.all(
      images.map(async (img) => uploadUnpublishedPhoto(pageId, ctx.accessToken, await ctx.resolver.signedUrl(img))),
    );
    const data = await graphPost(`/${pageId}/feed`, {
      message: ctx.content,
      attached_media: JSON.stringify(fbids.map((id) => ({ media_fbid: id }))),
      access_token: ctx.accessToken,
    });
    return { externalId: data.id, externalUrl: `https://facebook.com/${data.id}` };
  }

  const data = await graphPost(`/${pageId}/feed`, { message: ctx.content, access_token: ctx.accessToken });
  return { externalId: data.id, externalUrl: `https://facebook.com/${data.id}` };
}

/** Reels: start → upload the file by URL → finish (publish). */
async function publishReel(ctx: PublishContext, pageId: string): Promise<PublishResult> {
  const media = mediaFor(ctx, ctx.mediaIds).find((m) => m.kind === 'video');
  if (!media) {
    throw new SocialApiError({ platform: 'facebook', httpStatus: 0, kind: 'VALIDATION', message: 'Un reel de Facebook necesita un video' });
  }
  const start = await graphPost(`/${pageId}/video_reels`, { upload_phase: 'start', access_token: ctx.accessToken });
  const videoId = (start as unknown as { video_id: string }).video_id;
  const videoUrl = await ctx.resolver.signedUrl(media);

  const uploadUrl = new URL(`https://rupload.facebook.com/video-upload/${process.env.META_GRAPH_VERSION || 'v23.0'}/${videoId}`);
  await socialFetch(uploadUrl.toString(), {
    platform: 'facebook',
    method: 'POST',
    headers: { Authorization: `OAuth ${ctx.accessToken}`, file_url: videoUrl },
  });

  const finish = await graphPost(`/${pageId}/video_reels`, {
    upload_phase: 'finish',
    video_id: videoId,
    video_state: 'PUBLISHED',
    description: ctx.content,
    access_token: ctx.accessToken,
  });
  const success = (finish as unknown as { success?: boolean }).success;
  if (success === false) {
    throw new SocialApiError({ platform: 'facebook', httpStatus: 0, kind: 'TRANSIENT', message: 'Facebook no confirmó la publicación del reel' });
  }
  return { externalId: videoId, externalUrl: `https://facebook.com/reel/${videoId}` };
}

/** Story: upload the photo/video unpublished, then attach it as a story. */
async function publishStory(ctx: PublishContext, pageId: string): Promise<PublishResult> {
  const media = mediaFor(ctx, ctx.mediaIds)[0];
  if (!media) {
    throw new SocialApiError({ platform: 'facebook', httpStatus: 0, kind: 'VALIDATION', message: 'Una historia de Facebook necesita una imagen o video' });
  }
  const mediaUrl = await ctx.resolver.signedUrl(media);
  if (media.kind === 'video') {
    const uploaded = await graphPost(`/${pageId}/videos`, { file_url: mediaUrl, published: 'false', access_token: ctx.accessToken });
    const data = await graphPost(`/${pageId}/video_stories`, { video_id: uploaded.id, access_token: ctx.accessToken });
    return { externalId: data.id ?? uploaded.id, externalUrl: null };
  }
  const uploaded = await graphPost(`/${pageId}/photos`, { url: mediaUrl, published: 'false', access_token: ctx.accessToken });
  const data = await graphPost(`/${pageId}/photo_stories`, { photo_id: uploaded.id, access_token: ctx.accessToken });
  return { externalId: data.id ?? uploaded.id, externalUrl: null };
}

export const facebookPublisher: SocialPublisher = {
  async publish(ctx) {
    const pageId = ctx.account.platformAccountId;
    const postType = ctx.options.facebook?.postType ?? 'post';
    if (postType === 'reel') return publishReel(ctx, pageId);
    if (postType === 'story') return publishStory(ctx, pageId);
    return publishFeedPost(ctx, pageId);
  },

  async postFirstComment(ctx, parentExternalId, comment) {
    await graphPost(`/${parentExternalId}/comments`, { message: comment, access_token: ctx.accessToken });
  },
};
