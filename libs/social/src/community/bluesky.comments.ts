import { socialFetch } from '../http/social-http';
import type { NormalizedComment } from '../ingest/social-ingest.service';
import type { CommunityAdapter, CommunityActionContext, FetchSinceOptions, FetchSinceResult, ReplyResult } from './types';

const XRPC = 'https://bsky.social/xrpc';
const MAX_PAGES = 5;
const RELEVANT_REASONS = new Set(['reply', 'mention', 'quote']);

interface BskyRef {
  uri: string;
  cid: string;
}

interface BskyNotification {
  uri: string;
  cid: string;
  author: { did: string; handle: string; displayName?: string; avatar?: string };
  reason: string;
  record: { text?: string; reply?: { root: BskyRef; parent: BskyRef } };
  indexedAt: string;
}

interface ListNotificationsResponse {
  notifications: BskyNotification[];
  cursor?: string;
}

/** Encodes both halves of an AT-URI record ref into our externalId, needed later to build reply/like refs. */
function encodeRef(ref: BskyRef): string {
  return `${ref.uri}|${ref.cid}`;
}
function decodeRef(externalId: string): BskyRef {
  const [uri, cid] = externalId.split('|');
  return { uri, cid };
}

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

function toNormalized(tenantId: string, accountId: string, n: BskyNotification): NormalizedComment {
  return {
    tenantId,
    accountId,
    platform: 'bluesky',
    kind: n.reason === 'reply' ? 'comment' : 'mention',
    externalId: encodeRef({ uri: n.uri, cid: n.cid }),
    externalParentId: n.record.reply ? encodeRef(n.record.reply.parent) : null,
    externalPostId: n.record.reply ? n.record.reply.root.uri : null,
    authorName: n.author.displayName || n.author.handle,
    authorHandle: n.author.handle,
    authorAvatarUrl: n.author.avatar ?? null,
    authorExternalId: n.author.did,
    body: n.record.text ?? '',
    permalink: null,
    fromUs: false,
    platformCreatedAt: new Date(n.indexedAt),
  };
}

/** Resolves the `{root, parent}` refs to reply to `target` — root is `target` itself when it isn't already a reply. */
async function replyRefsFor(accessToken: string, target: BskyRef): Promise<{ root: BskyRef; parent: BskyRef }> {
  const url = new URL(`${XRPC}/app.bsky.feed.getPostThread`);
  url.searchParams.set('uri', target.uri);
  url.searchParams.set('depth', '0');
  const res = await socialFetch(url.toString(), { platform: 'bluesky', headers: authHeaders(accessToken) });
  const data = (await res.json()) as { thread: { post: { record?: { reply?: { root: BskyRef } } } } };
  const root = data.thread.post.record?.reply?.root ?? target;
  return { root, parent: target };
}

/** Bluesky notifications (reply/mention/quote) via AT Protocol (CONTRACT.md §1/§4) — 5 min poll, account-level. */
export const blueskyCommentsAdapter: CommunityAdapter = {
  async fetchSince(ctx: CommunityActionContext, opts: FetchSinceOptions): Promise<FetchSinceResult> {
    const items: NormalizedComment[] = [];
    const sinceTs = opts.since ? new Date(opts.since).getTime() : 0;
    let maxTs = sinceTs;
    let cursor: string | undefined;
    let stop = false;

    for (let page = 0; page < MAX_PAGES && !stop; page++) {
      const url = new URL(`${XRPC}/app.bsky.notification.listNotifications`);
      url.searchParams.set('limit', '50');
      if (cursor) url.searchParams.set('cursor', cursor);
      const res = await socialFetch(url.toString(), { platform: 'bluesky', headers: authHeaders(ctx.accessToken) });
      const data = (await res.json()) as ListNotificationsResponse;

      for (const n of data.notifications ?? []) {
        const ts = new Date(n.indexedAt).getTime();
        if (ts <= sinceTs) {
          stop = true;
          break;
        }
        if (!RELEVANT_REASONS.has(n.reason)) continue;
        items.push(toNormalized(ctx.account.tenantId, ctx.account.id, n));
        maxTs = Math.max(maxTs, ts);
      }

      cursor = data.cursor;
      if (!cursor) break;
    }

    return { items, cursor: new Date(maxTs || Date.now()).toISOString() };
  },

  async reply(ctx, comment, text): Promise<ReplyResult> {
    const target = decodeRef(comment.externalId);
    const refs = await replyRefsFor(ctx.accessToken, target);
    const res = await socialFetch(`${XRPC}/com.atproto.repo.createRecord`, {
      platform: 'bluesky',
      method: 'POST',
      headers: { ...authHeaders(ctx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: ctx.account.platformAccountId,
        collection: 'app.bsky.feed.post',
        record: { $type: 'app.bsky.feed.post', text, reply: refs, createdAt: new Date().toISOString() },
      }),
    });
    const data = (await res.json()) as BskyRef;
    return { externalId: encodeRef(data), permalink: null };
  },

  async like(ctx, comment): Promise<void> {
    const target = decodeRef(comment.externalId);
    await socialFetch(`${XRPC}/com.atproto.repo.createRecord`, {
      platform: 'bluesky',
      method: 'POST',
      headers: { ...authHeaders(ctx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: ctx.account.platformAccountId,
        collection: 'app.bsky.feed.like',
        record: { $type: 'app.bsky.feed.like', subject: target, createdAt: new Date().toISOString() },
      }),
    });
  },

  async unlike(ctx, comment): Promise<void> {
    const target = decodeRef(comment.externalId);
    const url = new URL(`${XRPC}/com.atproto.repo.listRecords`);
    url.searchParams.set('repo', ctx.account.platformAccountId);
    url.searchParams.set('collection', 'app.bsky.feed.like');
    url.searchParams.set('limit', '100');
    const res = await socialFetch(url.toString(), { platform: 'bluesky', headers: authHeaders(ctx.accessToken) });
    const data = (await res.json()) as { records: { uri: string; value: { subject: BskyRef } }[] };
    const match = data.records.find((r) => r.value.subject.uri === target.uri);
    if (!match) return;
    const rkey = match.uri.split('/').pop()!;
    await socialFetch(`${XRPC}/com.atproto.repo.deleteRecord`, {
      platform: 'bluesky',
      method: 'POST',
      headers: { ...authHeaders(ctx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: ctx.account.platformAccountId, collection: 'app.bsky.feed.like', rkey }),
    });
  },
};
