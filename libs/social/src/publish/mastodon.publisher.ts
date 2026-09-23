import { socialFetch, SocialApiError } from '../http/social-http';
import type { SocialMedia } from '@prisma/client';
import { toBytes } from './bytes';
import type { PublishContext, PublishResult, SocialPublisher } from './types';
import { mediaFor } from './types';

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_TRIES = 30;

function instanceOf(ctx: PublishContext): string {
  const host = ctx.secrets.instance as string | undefined;
  if (!host) throw new SocialApiError({ platform: 'mastodon', httpStatus: 0, kind: 'NOT_CONFIGURED', message: 'Cuenta de Mastodon sin instancia guardada — reconectar' });
  return host;
}

async function uploadMedia(ctx: PublishContext, host: string, media: SocialMedia): Promise<string> {
  const buf = await ctx.resolver.buffer(media);
  const form = new FormData();
  form.set('file', new Blob([toBytes(buf)], { type: media.mimeType }), media.fileName ?? media.id);
  if (media.altText) form.set('description', media.altText);

  const res = await socialFetch(`https://${host}/api/v2/media`, {
    platform: 'mastodon',
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.accessToken}` },
    body: form,
  });
  const data = (await res.json()) as { id: string; url?: string | null };
  if (data.url) return data.id;

  for (let i = 0; i < POLL_MAX_TRIES; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const statusRes = await socialFetch(`https://${host}/api/v1/media/${data.id}`, {
      platform: 'mastodon',
      headers: { Authorization: `Bearer ${ctx.accessToken}` },
    });
    if (statusRes.status === 200) {
      const statusData = (await statusRes.json()) as { url?: string | null };
      if (statusData.url) return data.id;
    }
  }
  throw new SocialApiError({ platform: 'mastodon', httpStatus: 0, kind: 'TRANSIENT', message: 'Mastodon tardó demasiado en procesar el medio' });
}

async function postStatus(ctx: PublishContext, host: string, text: string, media: SocialMedia[], inReplyToId: string | null): Promise<PublishResult> {
  const mediaIds = await Promise.all(media.map((m) => uploadMedia(ctx, host, m)));
  const opts = ctx.options.mastodon;

  const body: Record<string, unknown> = {
    status: text,
    media_ids: mediaIds,
    visibility: opts?.visibility ?? 'public',
  };
  if (opts?.spoilerText) body.spoiler_text = opts.spoilerText;
  if (opts?.sensitive !== undefined) body.sensitive = opts.sensitive;
  if (opts?.language) body.language = opts.language;
  if (inReplyToId) body.in_reply_to_id = inReplyToId;

  const res = await socialFetch(`https://${host}/api/v1/statuses`, {
    platform: 'mastodon',
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { id: string; url: string };
  return { externalId: data.id, externalUrl: data.url };
}

export const mastodonPublisher: SocialPublisher = {
  async publish(ctx) {
    const host = instanceOf(ctx);
    const media = mediaFor(ctx, ctx.mediaIds);
    return postStatus(ctx, host, ctx.content, media, null);
  },

  async publishThreadItem(ctx, chain, item) {
    const host = instanceOf(ctx);
    const media = mediaFor(ctx, item.mediaIds);
    return postStatus(ctx, host, item.content, media, chain.parent.externalId);
  },
};
