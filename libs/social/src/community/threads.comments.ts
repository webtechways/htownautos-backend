import { socialFetch, SocialApiError } from '../http/social-http';
import type { NormalizedComment } from '../ingest/social-ingest.service';
import type { CommunityAdapter, CommunityActionContext, FetchSinceOptions, FetchSinceResult, ReplyResult } from './types';

const THREADS_BASE = 'https://graph.threads.net/v1.0';
const MAX_POSTS_PER_POLL = 25;
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_TRIES = 20;

interface ThreadsReplyNode {
  id: string;
  text?: string;
  username?: string;
  timestamp: string;
  permalink?: string;
  root_post?: { id: string };
  replied_to?: { id: string };
}

interface ThreadsPage {
  data: ThreadsReplyNode[];
}

function toNormalized(
  tenantId: string,
  accountId: string,
  kind: 'comment' | 'mention',
  postId: string | null,
  node: ThreadsReplyNode,
): NormalizedComment {
  return {
    tenantId,
    accountId,
    platform: 'threads',
    kind,
    externalId: node.id,
    externalParentId: node.replied_to?.id && node.replied_to.id !== postId ? node.replied_to.id : null,
    externalPostId: postId ?? node.root_post?.id ?? null,
    authorName: node.username ?? 'Threads user',
    authorHandle: node.username ?? null,
    authorAvatarUrl: null,
    authorExternalId: null,
    body: node.text ?? '',
    permalink: node.permalink ?? null,
    fromUs: false,
    platformCreatedAt: new Date(node.timestamp),
  };
}

async function threadsGet(path: string, params: Record<string, string>): Promise<ThreadsPage> {
  const url = new URL(`${THREADS_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await socialFetch(url.toString(), { platform: 'threads' });
  return (await res.json()) as ThreadsPage;
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
      throw new SocialApiError({ platform: 'threads', httpStatus: 0, kind: 'VALIDATION', message: `Threads no pudo procesar la respuesta (${data.status})` });
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new SocialApiError({ platform: 'threads', httpStatus: 0, kind: 'TRANSIENT', message: 'Threads tardó demasiado en publicar la respuesta' });
}

/** Threads replies to our own posts + account-level mentions (CONTRACT.md §1/§4) — 5 min poll. */
export const threadsCommentsAdapter: CommunityAdapter = {
  async fetchSince(ctx: CommunityActionContext, opts: FetchSinceOptions): Promise<FetchSinceResult> {
    const items: NormalizedComment[] = [];
    let maxTs = opts.since ? new Date(opts.since).getTime() : 0;
    const sinceTs = opts.since ? new Date(opts.since).getTime() : 0;

    for (const postId of opts.postExternalIds.slice(0, MAX_POSTS_PER_POLL)) {
      const page = await threadsGet(`/${postId}/replies`, {
        fields: 'id,text,username,timestamp,permalink,root_post,replied_to',
        access_token: ctx.accessToken,
      });
      for (const node of page.data ?? []) {
        const ts = new Date(node.timestamp).getTime();
        if (ts <= sinceTs) continue;
        items.push(toNormalized(ctx.account.tenantId, ctx.account.id, 'comment', postId, node));
        maxTs = Math.max(maxTs, ts);
      }
    }

    const mentions = await threadsGet(`/${ctx.account.platformAccountId}/mentions`, {
      fields: 'id,text,username,timestamp,permalink',
      access_token: ctx.accessToken,
    });
    for (const node of mentions.data ?? []) {
      const ts = new Date(node.timestamp).getTime();
      if (ts <= sinceTs) continue;
      items.push(toNormalized(ctx.account.tenantId, ctx.account.id, 'mention', null, node));
      maxTs = Math.max(maxTs, ts);
    }

    return { items, cursor: new Date(maxTs || Date.now()).toISOString() };
  },

  async reply(ctx, comment, text): Promise<ReplyResult> {
    const createUrl = new URL(`${THREADS_BASE}/${ctx.account.platformAccountId}/threads`);
    createUrl.searchParams.set('media_type', 'TEXT');
    createUrl.searchParams.set('text', text);
    createUrl.searchParams.set('reply_to_id', comment.externalId);
    createUrl.searchParams.set('access_token', ctx.accessToken);
    const createRes = await socialFetch(createUrl.toString(), { platform: 'threads', method: 'POST' });
    const created = (await createRes.json()) as { id: string };

    await pollUntilFinished(created.id, ctx.accessToken);

    const publishUrl = new URL(`${THREADS_BASE}/${ctx.account.platformAccountId}/threads_publish`);
    publishUrl.searchParams.set('creation_id', created.id);
    publishUrl.searchParams.set('access_token', ctx.accessToken);
    const publishRes = await socialFetch(publishUrl.toString(), { platform: 'threads', method: 'POST' });
    const published = (await publishRes.json()) as { id: string };
    return { externalId: published.id, permalink: null };
  },

  async hide(ctx, comment): Promise<void> {
    const url = new URL(`${THREADS_BASE}/${comment.externalId}/manage_reply`);
    url.searchParams.set('hide', 'true');
    url.searchParams.set('access_token', ctx.accessToken);
    await socialFetch(url.toString(), { platform: 'threads', method: 'POST' });
  },

  async unhide(ctx, comment): Promise<void> {
    const url = new URL(`${THREADS_BASE}/${comment.externalId}/manage_reply`);
    url.searchParams.set('hide', 'false');
    url.searchParams.set('access_token', ctx.accessToken);
    await socialFetch(url.toString(), { platform: 'threads', method: 'POST' });
  },
};
