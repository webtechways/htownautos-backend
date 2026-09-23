import { socialFetch } from '../http/social-http';
import type { NormalizedComment } from '../ingest/social-ingest.service';
import type { CommunityAdapter, CommunityActionContext, FetchSinceOptions, FetchSinceResult, ReplyResult } from './types';

const REST_BASE = 'https://api.linkedin.com/rest';
const LINKEDIN_VERSION = process.env.LINKEDIN_API_VERSION || '202502';
const MAX_POSTS_PER_POLL = 25;

function headers(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'LinkedIn-Version': LINKEDIN_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
  };
}

function authorUrn(ctx: CommunityActionContext): string {
  return ctx.account.accountType === 'organization'
    ? `urn:li:organization:${ctx.account.platformAccountId}`
    : `urn:li:person:${ctx.account.platformAccountId}`;
}

interface LiComment {
  id: string;
  commentUrn: string;
  message: { text: string };
  actor: string;
  created: { time: number };
  object: string;
}

interface LiCommentsPage {
  elements: LiComment[];
}

function toNormalized(tenantId: string, accountId: string, postUrn: string, node: LiComment): NormalizedComment {
  return {
    tenantId,
    accountId,
    platform: 'linkedin',
    kind: 'comment',
    externalId: node.commentUrn,
    externalParentId: null, // LinkedIn's Community Management API doesn't expose nested-reply parentage on read.
    externalPostId: postUrn,
    authorName: node.actor,
    authorHandle: null,
    authorAvatarUrl: null,
    authorExternalId: node.actor,
    body: node.message?.text ?? '',
    permalink: null,
    fromUs: false,
    platformCreatedAt: new Date(node.created.time),
  };
}

/**
 * LinkedIn org post comments via `socialActions` (Community Management API —
 * requires LinkedIn partner approval; CONTRACT.md §1/§4) — 5 min poll,
 * per-post. A `PERMISSION` (403) error means the app isn't approved for this
 * scope on this org: `CommunityPollService` catches it, logs once, and stops
 * polling the account rather than retrying every 5 minutes forever.
 */
export const linkedinCommentsAdapter: CommunityAdapter = {
  async fetchSince(ctx: CommunityActionContext, opts: FetchSinceOptions): Promise<FetchSinceResult> {
    const items: NormalizedComment[] = [];
    const sinceTs = opts.since ? new Date(opts.since).getTime() : 0;
    let maxTs = sinceTs;

    for (const postUrn of opts.postExternalIds.slice(0, MAX_POSTS_PER_POLL)) {
      const url = `${REST_BASE}/socialActions/${encodeURIComponent(postUrn)}/comments`;
      const res = await socialFetch(url, { platform: 'linkedin', headers: headers(ctx.accessToken) });
      const page = (await res.json()) as LiCommentsPage;
      for (const node of page.elements ?? []) {
        const ts = node.created.time;
        if (ts <= sinceTs) continue;
        items.push(toNormalized(ctx.account.tenantId, ctx.account.id, postUrn, node));
        maxTs = Math.max(maxTs, ts);
      }
    }

    return { items, cursor: new Date(maxTs || Date.now()).toISOString() };
  },

  async reply(ctx, comment, text): Promise<ReplyResult> {
    const postUrn = comment.externalPostId!;
    const url = `${REST_BASE}/socialActions/${encodeURIComponent(postUrn)}/comments`;
    const res = await socialFetch(url, {
      platform: 'linkedin',
      method: 'POST',
      headers: { ...headers(ctx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor: authorUrn(ctx), object: postUrn, message: { text } }),
    });
    const data = (await res.json()) as { commentUrn: string };
    return { externalId: data.commentUrn, permalink: null };
  },

  async delete(ctx, comment): Promise<void> {
    const postUrn = comment.externalPostId!;
    const commentId = comment.externalId.split(',').pop()!.replace(/\)$/, '');
    const url = new URL(`${REST_BASE}/socialActions/${encodeURIComponent(postUrn)}/comments/${commentId}`);
    if (ctx.account.accountType === 'organization') url.searchParams.set('actor', authorUrn(ctx));
    await socialFetch(url.toString(), { platform: 'linkedin', method: 'DELETE', headers: headers(ctx.accessToken) });
  },
};
