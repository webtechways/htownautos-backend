import { socialFetch, SocialApiError } from '../http/social-http';
import { buildBlueskyFacets } from './bluesky-facets';
import { toBytes } from './bytes';
import type { SocialMedia } from '@prisma/client';
import type { PublishContext, PublishResult, SocialPublisher } from './types';
import { mediaFor } from './types';

const XRPC = 'https://bsky.social/xrpc';
const VIDEO_SERVICE = 'https://video.bsky.app/xrpc';
const MAX_IMAGE_BYTES = 1_000_000; // AT Proto blob limit for feed images
const VIDEO_POLL_INTERVAL_MS = 3000;
const VIDEO_POLL_MAX_TRIES = 100; // video processing can take a few minutes

/** `PublishResult.externalId` encodes both halves of an AT-URI record ref, needed to build reply refs. */
function encodeRef(uri: string, cid: string): string {
  return `${uri}|${cid}`;
}
function decodeRef(externalId: string): { uri: string; cid: string } {
  const [uri, cid] = externalId.split('|');
  return { uri, cid };
}

async function resolveMentionDid(accessToken: string, handle: string): Promise<string | null> {
  try {
    const url = new URL(`${XRPC}/com.atproto.identity.resolveHandle`);
    url.searchParams.set('handle', handle);
    const res = await socialFetch(url.toString(), { platform: 'bluesky', headers: { Authorization: `Bearer ${accessToken}` } });
    const data = (await res.json()) as { did?: string };
    return data.did ?? null;
  } catch {
    return null;
  }
}

async function uploadImageBlob(ctx: PublishContext, media: SocialMedia): Promise<{ $type: string; ref: { $link: string }; mimeType: string; size: number }> {
  const buf = await ctx.resolver.fitUnder(media, MAX_IMAGE_BYTES);
  const res = await socialFetch(`${XRPC}/com.atproto.repo.uploadBlob`, {
    platform: 'bluesky',
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'image/jpeg' },
    body: toBytes(buf),
  });
  const data = (await res.json()) as { blob: { $type: string; ref: { $link: string }; mimeType: string; size: number } };
  return data.blob;
}

async function uploadVideoBlob(ctx: PublishContext, media: SocialMedia): Promise<{ $type: string; ref: { $link: string }; mimeType: string; size: number }> {
  const authRes = await socialFetch(
    `${XRPC}/com.atproto.server.getServiceAuth?aud=did:web:video.bsky.app&lxm=app.bsky.video.uploadVideo`,
    { platform: 'bluesky', headers: { Authorization: `Bearer ${ctx.accessToken}` } },
  );
  const auth = (await authRes.json()) as { token: string };

  const buf = await ctx.resolver.buffer(media);
  const uploadUrl = new URL(`${VIDEO_SERVICE}/app.bsky.video.uploadVideo`);
  uploadUrl.searchParams.set('did', ctx.account.platformAccountId);
  uploadUrl.searchParams.set('name', media.fileName || `${media.id}.mp4`);
  const uploadRes = await socialFetch(uploadUrl.toString(), {
    platform: 'bluesky',
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': media.mimeType },
    body: toBytes(buf),
  });
  const job = (await uploadRes.json()) as { jobId: string; blob?: { $type: string; ref: { $link: string }; mimeType: string; size: number } };
  if (job.blob) return job.blob;

  for (let i = 0; i < VIDEO_POLL_MAX_TRIES; i++) {
    await new Promise((r) => setTimeout(r, VIDEO_POLL_INTERVAL_MS));
    const statusUrl = new URL(`${VIDEO_SERVICE}/app.bsky.video.getJobStatus`);
    statusUrl.searchParams.set('jobId', job.jobId);
    const statusRes = await socialFetch(statusUrl.toString(), { platform: 'bluesky' });
    const status = (await statusRes.json()) as { jobStatus: { state: string; blob?: typeof job.blob; error?: string } };
    if (status.jobStatus.state === 'JOB_STATE_COMPLETED' && status.jobStatus.blob) return status.jobStatus.blob;
    if (status.jobStatus.state === 'JOB_STATE_FAILED') {
      throw new SocialApiError({ platform: 'bluesky', httpStatus: 0, kind: 'VALIDATION', message: `Bluesky no pudo procesar el video: ${status.jobStatus.error ?? 'desconocido'}` });
    }
  }
  throw new SocialApiError({ platform: 'bluesky', httpStatus: 0, kind: 'TRANSIENT', message: 'Bluesky tardó demasiado en procesar el video' });
}

async function buildEmbed(ctx: PublishContext, media: SocialMedia[]): Promise<Record<string, unknown> | undefined> {
  const video = media.find((m) => m.kind === 'video');
  if (video) {
    const blob = await uploadVideoBlob(ctx, video);
    return { $type: 'app.bsky.embed.video', video: blob, alt: video.altText ?? '' };
  }
  const images = media.filter((m) => m.kind === 'image');
  if (images.length === 0) return undefined;
  const blobs = await Promise.all(images.slice(0, 4).map((m) => uploadImageBlob(ctx, m)));
  return { $type: 'app.bsky.embed.images', images: blobs.map((image, i) => ({ image, alt: images[i].altText ?? '' })) };
}

async function createPost(
  ctx: PublishContext,
  text: string,
  media: SocialMedia[],
  reply: { root: { uri: string; cid: string }; parent: { uri: string; cid: string } } | null,
): Promise<PublishResult> {
  const facets = await buildBlueskyFacets(text, (handle) => resolveMentionDid(ctx.accessToken, handle));
  const embed = await buildEmbed(ctx, media);

  const record: Record<string, unknown> = {
    $type: 'app.bsky.feed.post',
    text,
    createdAt: new Date().toISOString(),
    ...(facets.length > 0 ? { facets } : {}),
    ...(embed ? { embed } : {}),
    ...(ctx.options.bluesky?.langs ? { langs: ctx.options.bluesky.langs } : {}),
    ...(reply ? { reply } : {}),
  };

  const res = await socialFetch(`${XRPC}/com.atproto.repo.createRecord`, {
    platform: 'bluesky',
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo: ctx.account.platformAccountId, collection: 'app.bsky.feed.post', record }),
  });
  const data = (await res.json()) as { uri: string; cid: string };
  const handle = ctx.account.username ?? ctx.account.platformAccountId;
  const rkey = data.uri.split('/').pop();
  return { externalId: encodeRef(data.uri, data.cid), externalUrl: `https://bsky.app/profile/${handle}/post/${rkey}` };
}

export const blueskyPublisher: SocialPublisher = {
  async publish(ctx) {
    const media = mediaFor(ctx, ctx.mediaIds);
    return createPost(ctx, ctx.content, media, null);
  },

  async publishThreadItem(ctx, chain, item) {
    const media = mediaFor(ctx, item.mediaIds);
    const root = decodeRef(chain.root.externalId);
    const parent = decodeRef(chain.parent.externalId);
    return createPost(ctx, item.content, media, { root, parent });
  },
};
