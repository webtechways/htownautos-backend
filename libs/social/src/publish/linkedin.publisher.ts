import { socialFetch, SocialApiError } from '../http/social-http';
import { iterateRangeChunks } from './chunk-source';
import { toBytes } from './bytes';
import type { SocialMedia } from '@prisma/client';
import type { PublishContext, PublishResult, SocialPublisher } from './types';
import { mediaFor } from './types';

const REST_BASE = 'https://api.linkedin.com/rest';
/** `LinkedIn-Version` header — YYYYMM, required on every /rest call. Override via env if LinkedIn deprecates this one. */
const LINKEDIN_VERSION = process.env.LINKEDIN_API_VERSION || '202502';
const VIDEO_PART_BYTES = 4 * 1024 * 1024;

function headers(accessToken: string, extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'LinkedIn-Version': LINKEDIN_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
    ...extra,
  };
}

function authorUrn(ctx: PublishContext): string {
  return ctx.account.accountType === 'organization'
    ? `urn:li:organization:${ctx.account.platformAccountId}`
    : `urn:li:person:${ctx.account.platformAccountId}`;
}

async function uploadImage(ctx: PublishContext, media: SocialMedia): Promise<string> {
  const initRes = await socialFetch(`${REST_BASE}/images?action=initializeUpload`, {
    platform: 'linkedin',
    method: 'POST',
    headers: headers(ctx.accessToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ initializeUploadRequest: { owner: authorUrn(ctx) } }),
  });
  const init = (await initRes.json()) as { value: { uploadUrl: string; image: string } };

  const buf = await ctx.resolver.buffer(media);
  await socialFetch(init.value.uploadUrl, { platform: 'linkedin', method: 'PUT', headers: { Authorization: `Bearer ${ctx.accessToken}` }, body: toBytes(buf) });
  return init.value.image;
}

async function uploadDocument(ctx: PublishContext, media: SocialMedia): Promise<string> {
  const initRes = await socialFetch(`${REST_BASE}/documents?action=initializeUpload`, {
    platform: 'linkedin',
    method: 'POST',
    headers: headers(ctx.accessToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ initializeUploadRequest: { owner: authorUrn(ctx) } }),
  });
  const init = (await initRes.json()) as { value: { uploadUrl: string; document: string } };

  const buf = await ctx.resolver.buffer(media);
  await socialFetch(init.value.uploadUrl, { platform: 'linkedin', method: 'PUT', headers: { Authorization: `Bearer ${ctx.accessToken}` }, body: toBytes(buf) });
  return init.value.document;
}

/** Multi-part video upload: LinkedIn hands back one `uploadUrl` per byte range — read each range straight off the signed URL. */
async function uploadVideo(ctx: PublishContext, media: SocialMedia): Promise<string> {
  const initRes = await socialFetch(`${REST_BASE}/videos?action=initializeUpload`, {
    platform: 'linkedin',
    method: 'POST',
    headers: headers(ctx.accessToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      initializeUploadRequest: { owner: authorUrn(ctx), fileSizeBytes: media.sizeBytes, uploadCaptions: false, uploadThumbnail: false },
    }),
  });
  const init = (await initRes.json()) as {
    value: { video: string; uploadInstructions: { uploadUrl: string; firstByte: number; lastByte: number }[]; uploadToken?: string };
  };

  const signedUrl = await ctx.resolver.signedUrl(media);
  const etags: { httpStatus: number; etag: string }[] = [];
  for (const part of init.value.uploadInstructions) {
    const size = part.lastByte - part.firstByte + 1;
    let partBuf = Buffer.alloc(0);
    for await (const chunk of iterateRangeChunks(signedUrl, media.sizeBytes, Math.min(size, VIDEO_PART_BYTES))) {
      if (chunk.start >= part.firstByte && chunk.end <= part.lastByte) partBuf = Buffer.concat([partBuf, chunk.buffer]);
    }
    const putRes = await socialFetch(part.uploadUrl, { platform: 'linkedin', method: 'PUT', headers: { Authorization: `Bearer ${ctx.accessToken}` }, body: toBytes(partBuf) });
    etags.push({ httpStatus: putRes.status, etag: putRes.headers.get('etag') || '' });
  }

  await socialFetch(`${REST_BASE}/videos?action=finalizeUpload`, {
    platform: 'linkedin',
    method: 'POST',
    headers: headers(ctx.accessToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      finalizeUploadRequest: { video: init.value.video, uploadToken: init.value.uploadToken || '', uploadedPartIds: etags.map((e) => e.etag) },
    }),
  });
  return init.value.video;
}

export const linkedinPublisher: SocialPublisher = {
  async publish(ctx) {
    const media = mediaFor(ctx, ctx.mediaIds);
    const visibility = ctx.options.linkedin?.visibility ?? 'PUBLIC';

    const body: Record<string, unknown> = {
      author: authorUrn(ctx),
      commentary: ctx.content,
      visibility,
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };

    if (media.length === 1 && media[0].kind === 'document') {
      const urn = await uploadDocument(ctx, media[0]);
      body.content = { media: { id: urn, title: ctx.options.linkedin?.documentTitle ?? media[0].fileName ?? 'Documento' } };
    } else if (media.length === 1 && media[0].kind === 'video') {
      const urn = await uploadVideo(ctx, media[0]);
      body.content = { media: { id: urn } };
    } else if (media.length === 1) {
      const urn = await uploadImage(ctx, media[0]);
      body.content = { media: { id: urn } };
    } else if (media.length > 1) {
      const urns = await Promise.all(media.map((m) => uploadImage(ctx, m)));
      body.content = { multiImage: { images: urns.map((id) => ({ id })) } };
    }

    const res = await socialFetch(`${REST_BASE}/posts`, {
      platform: 'linkedin',
      method: 'POST',
      headers: headers(ctx.accessToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    const postUrn = res.headers.get('x-restli-id') || res.headers.get('x-linkedin-id') || '';
    if (!postUrn) throw new SocialApiError({ platform: 'linkedin', httpStatus: 0, kind: 'TRANSIENT', message: 'LinkedIn no devolvió el id del post' });
    return { externalId: postUrn, externalUrl: `https://www.linkedin.com/feed/update/${postUrn}` };
  },

  async postFirstComment(ctx, parentExternalId, comment) {
    await socialFetch(`${REST_BASE}/socialActions/${encodeURIComponent(parentExternalId)}/comments`, {
      platform: 'linkedin',
      method: 'POST',
      headers: headers(ctx.accessToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ actor: authorUrn(ctx), object: parentExternalId, message: { text: comment } }),
    });
  },
};
