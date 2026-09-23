import { socialFetch } from '../http/social-http';
import { graphUrl } from '../connect/meta-graph';
import type { NormalizedComment } from '../ingest/social-ingest.service';
import type { CommunityAdapter, CommunityActionContext, FetchSinceOptions, FetchSinceResult, ReplyResult } from './types';

const MAX_POSTS_PER_POLL = 25;

interface IgCommentNode {
  id: string;
  text?: string;
  username?: string;
  timestamp: string;
  parent_id?: string;
}

interface IgCommentsPage {
  data: IgCommentNode[];
}

function toNormalized(tenantId: string, accountId: string, mediaId: string, node: IgCommentNode): NormalizedComment {
  return {
    tenantId,
    accountId,
    platform: 'instagram',
    kind: 'comment',
    externalId: node.id,
    externalParentId: node.parent_id && node.parent_id !== mediaId ? node.parent_id : null,
    externalPostId: mediaId,
    authorName: node.username ?? 'Instagram user',
    authorHandle: node.username ?? null,
    authorAvatarUrl: null, // IG's comments edge doesn't return the commenter's profile picture.
    authorExternalId: null,
    body: node.text ?? '',
    permalink: null,
    fromUs: false,
    platformCreatedAt: new Date(node.timestamp),
  };
}

/**
 * Instagram Business/Creator media comments (CONTRACT.md §1/§4) — 30 min
 * backfill, webhook `comments`/`mentions` is primary (owned by B3,
 * `apps/api/src/social/webhooks`). Mentions have no polling counterpart:
 * they only reach us via the webhook.
 */
export const instagramCommentsAdapter: CommunityAdapter = {
  async fetchSince(ctx: CommunityActionContext, opts: FetchSinceOptions): Promise<FetchSinceResult> {
    const items: NormalizedComment[] = [];
    let maxTs = opts.since ? new Date(opts.since).getTime() : 0;

    for (const mediaId of opts.postExternalIds.slice(0, MAX_POSTS_PER_POLL)) {
      const url = new URL(graphUrl(`/${mediaId}/comments`));
      url.searchParams.set('fields', 'id,text,username,timestamp,parent_id');
      url.searchParams.set('access_token', ctx.accessToken);
      const res = await socialFetch(url.toString(), { platform: 'instagram' });
      const page = (await res.json()) as IgCommentsPage;
      for (const node of page.data ?? []) {
        const ts = new Date(node.timestamp).getTime();
        if (opts.since && ts <= new Date(opts.since).getTime()) continue;
        items.push(toNormalized(ctx.account.tenantId, ctx.account.id, mediaId, node));
        maxTs = Math.max(maxTs, ts);
      }
    }

    return { items, cursor: new Date(maxTs || Date.now()).toISOString() };
  },

  async reply(ctx, comment, text): Promise<ReplyResult> {
    const url = new URL(graphUrl(`/${comment.externalId}/replies`));
    url.searchParams.set('message', text);
    url.searchParams.set('access_token', ctx.accessToken);
    const res = await socialFetch(url.toString(), { platform: 'instagram', method: 'POST' });
    const data = (await res.json()) as { id: string };
    return { externalId: data.id, permalink: null };
  },

  async hide(ctx, comment): Promise<void> {
    const url = new URL(graphUrl(`/${comment.externalId}`));
    url.searchParams.set('hide', 'true');
    url.searchParams.set('access_token', ctx.accessToken);
    await socialFetch(url.toString(), { platform: 'instagram', method: 'POST' });
  },

  async unhide(ctx, comment): Promise<void> {
    const url = new URL(graphUrl(`/${comment.externalId}`));
    url.searchParams.set('hide', 'false');
    url.searchParams.set('access_token', ctx.accessToken);
    await socialFetch(url.toString(), { platform: 'instagram', method: 'POST' });
  },

  async delete(ctx, comment): Promise<void> {
    const url = new URL(graphUrl(`/${comment.externalId}`));
    url.searchParams.set('access_token', ctx.accessToken);
    await socialFetch(url.toString(), { platform: 'instagram', method: 'DELETE' });
  },
};
