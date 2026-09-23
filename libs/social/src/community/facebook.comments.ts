import { socialFetch } from '../http/social-http';
import { graphUrl } from '../connect/meta-graph';
import type { NormalizedComment } from '../ingest/social-ingest.service';
import type { CommunityAdapter, CommunityActionContext, FetchSinceOptions, FetchSinceResult, ReplyResult } from './types';

const MAX_POSTS_PER_POLL = 25;

interface FbCommentNode {
  id: string;
  message?: string;
  from?: { id: string; name: string };
  created_time: string;
  permalink_url?: string;
  parent?: { id: string };
  comment_count?: number;
}

interface FbCommentsPage {
  data: FbCommentNode[];
  paging?: { next?: string };
}

function toNormalized(tenantId: string, accountId: string, postId: string, node: FbCommentNode): NormalizedComment {
  return {
    tenantId,
    accountId,
    platform: 'facebook',
    kind: 'comment',
    externalId: node.id,
    externalParentId: node.parent && node.parent.id !== postId ? node.parent.id : null,
    externalPostId: postId,
    authorName: node.from?.name ?? 'Facebook user',
    authorHandle: null,
    authorAvatarUrl: node.from?.id ? `https://graph.facebook.com/${node.from.id}/picture?type=square` : null,
    authorExternalId: node.from?.id ?? null,
    body: node.message ?? '',
    permalink: node.permalink_url ?? null,
    fromUs: false,
    platformCreatedAt: new Date(node.created_time),
  };
}

/** Facebook Page post comments (CONTRACT.md §1/§4) — 30 min backfill, webhook `feed` is primary (owned by B3, `apps/api/src/social/webhooks`). */
export const facebookCommentsAdapter: CommunityAdapter = {
  async fetchSince(ctx: CommunityActionContext, opts: FetchSinceOptions): Promise<FetchSinceResult> {
    const items: NormalizedComment[] = [];
    const sinceUnix = opts.since ? Math.floor(new Date(opts.since).getTime() / 1000) : undefined;
    let maxCreatedTime = opts.since ? new Date(opts.since).getTime() : 0;

    for (const postId of opts.postExternalIds.slice(0, MAX_POSTS_PER_POLL)) {
      const url = new URL(graphUrl(`/${postId}/comments`));
      url.searchParams.set('fields', 'id,message,from,created_time,permalink_url,parent,comment_count');
      url.searchParams.set('filter', 'stream');
      url.searchParams.set('order', 'chronological');
      url.searchParams.set('limit', '100');
      if (sinceUnix) url.searchParams.set('since', String(sinceUnix));
      url.searchParams.set('access_token', ctx.accessToken);

      const res = await socialFetch(url.toString(), { platform: 'facebook' });
      const page = (await res.json()) as FbCommentsPage;
      for (const node of page.data ?? []) {
        items.push(toNormalized(ctx.account.tenantId, ctx.account.id, postId, node));
        maxCreatedTime = Math.max(maxCreatedTime, new Date(node.created_time).getTime());
      }
    }

    return { items, cursor: new Date(maxCreatedTime || Date.now()).toISOString() };
  },

  async reply(ctx, comment, text): Promise<ReplyResult> {
    const url = new URL(graphUrl(`/${comment.externalId}/comments`));
    url.searchParams.set('message', text);
    url.searchParams.set('access_token', ctx.accessToken);
    const res = await socialFetch(url.toString(), { platform: 'facebook', method: 'POST' });
    const data = (await res.json()) as { id: string };
    return { externalId: data.id, permalink: null };
  },

  async like(ctx, comment): Promise<void> {
    const url = new URL(graphUrl(`/${comment.externalId}/likes`));
    url.searchParams.set('access_token', ctx.accessToken);
    await socialFetch(url.toString(), { platform: 'facebook', method: 'POST' });
  },

  async unlike(ctx, comment): Promise<void> {
    const url = new URL(graphUrl(`/${comment.externalId}/likes`));
    url.searchParams.set('access_token', ctx.accessToken);
    await socialFetch(url.toString(), { platform: 'facebook', method: 'DELETE' });
  },

  async hide(ctx, comment): Promise<void> {
    const url = new URL(graphUrl(`/${comment.externalId}`));
    url.searchParams.set('is_hidden', 'true');
    url.searchParams.set('access_token', ctx.accessToken);
    await socialFetch(url.toString(), { platform: 'facebook', method: 'POST' });
  },

  async unhide(ctx, comment): Promise<void> {
    const url = new URL(graphUrl(`/${comment.externalId}`));
    url.searchParams.set('is_hidden', 'false');
    url.searchParams.set('access_token', ctx.accessToken);
    await socialFetch(url.toString(), { platform: 'facebook', method: 'POST' });
  },

  async delete(ctx, comment): Promise<void> {
    const url = new URL(graphUrl(`/${comment.externalId}`));
    url.searchParams.set('access_token', ctx.accessToken);
    await socialFetch(url.toString(), { platform: 'facebook', method: 'DELETE' });
  },
};
