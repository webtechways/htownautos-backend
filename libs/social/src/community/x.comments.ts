import { Logger } from '@nestjs/common';
import { socialFetch, SocialApiError } from '../http/social-http';
import type { NormalizedComment } from '../ingest/social-ingest.service';
import type { CommunityAdapter, CommunityActionContext, FetchSinceOptions, FetchSinceResult, ReplyResult } from './types';

const API_BASE = 'https://api.x.com/2';
const logger = new Logger('XCommentsAdapter');
let loggedPermissionDenied = false;

interface XUser {
  id: string;
  username: string;
  name: string;
  profile_image_url?: string;
}

interface XTweet {
  id: string;
  text: string;
  created_at: string;
  author_id: string;
  in_reply_to_user_id?: string;
}

interface XMentionsResponse {
  data?: XTweet[];
  includes?: { users?: XUser[] };
}

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

function toNormalized(tenantId: string, accountId: string, tweet: XTweet, author: XUser | undefined): NormalizedComment {
  return {
    tenantId,
    accountId,
    platform: 'x',
    kind: 'mention',
    externalId: tweet.id,
    externalParentId: null,
    externalPostId: null,
    authorName: author?.name ?? 'X user',
    authorHandle: author?.username ?? null,
    authorAvatarUrl: author?.profile_image_url ?? null,
    authorExternalId: tweet.author_id,
    body: tweet.text,
    permalink: author?.username ? `https://x.com/${author.username}/status/${tweet.id}` : null,
    fromUs: false,
    platformCreatedAt: new Date(tweet.created_at),
  };
}

/**
 * X mentions timeline (CONTRACT.md §1/§4) — 5 min poll, requires a paid API
 * tier. A `PERMISSION` (403) error is logged once per process (not per
 * poll) so an unpaid tenant doesn't spam the logs every 5 minutes;
 * `CommunityPollService` still marks the account's poll disabled the same
 * way it does for LinkedIn permission errors.
 */
export const xCommentsAdapter: CommunityAdapter = {
  async fetchSince(ctx: CommunityActionContext, opts: FetchSinceOptions): Promise<FetchSinceResult> {
    const url = new URL(`${API_BASE}/users/${ctx.account.platformAccountId}/mentions`);
    url.searchParams.set('max_results', '100');
    url.searchParams.set('tweet.fields', 'created_at,author_id');
    url.searchParams.set('expansions', 'author_id');
    url.searchParams.set('user.fields', 'username,name,profile_image_url');
    if (opts.since) url.searchParams.set('since_id', opts.since);

    let data: XMentionsResponse;
    try {
      const res = await socialFetch(url.toString(), { platform: 'x', headers: authHeaders(ctx.accessToken) });
      data = (await res.json()) as XMentionsResponse;
    } catch (err) {
      if (err instanceof SocialApiError && err.kind === 'PERMISSION') {
        if (!loggedPermissionDenied) {
          logger.warn('X mentions requiere un tier de pago de la API — deshabilitando el poll de esta cuenta hasta reconectar');
          loggedPermissionDenied = true;
        }
      }
      throw err;
    }

    const users = new Map((data.includes?.users ?? []).map((u) => [u.id, u]));
    const tweets = data.data ?? [];
    const items = tweets.map((tweet) => toNormalized(ctx.account.tenantId, ctx.account.id, tweet, users.get(tweet.author_id)));

    let maxId = opts.since ?? '0';
    for (const tweet of tweets) {
      if (BigInt(tweet.id) > BigInt(maxId)) maxId = tweet.id;
    }

    return { items, cursor: maxId };
  },

  async reply(ctx, comment, text): Promise<ReplyResult> {
    const res = await socialFetch(`${API_BASE}/tweets`, {
      platform: 'x',
      method: 'POST',
      headers: { ...authHeaders(ctx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, reply: { in_reply_to_tweet_id: comment.externalId } }),
    });
    const data = (await res.json()) as { data: { id: string } };
    return { externalId: data.data.id, permalink: null };
  },

  async like(ctx, comment): Promise<void> {
    await socialFetch(`${API_BASE}/users/${ctx.account.platformAccountId}/likes`, {
      platform: 'x',
      method: 'POST',
      headers: { ...authHeaders(ctx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ tweet_id: comment.externalId }),
    });
  },

  async unlike(ctx, comment): Promise<void> {
    await socialFetch(`${API_BASE}/users/${ctx.account.platformAccountId}/likes/${comment.externalId}`, {
      platform: 'x',
      method: 'DELETE',
      headers: authHeaders(ctx.accessToken),
    });
  },

  async hide(ctx, comment): Promise<void> {
    await socialFetch(`${API_BASE}/tweets/${comment.externalId}/hidden`, {
      platform: 'x',
      method: 'PUT',
      headers: { ...authHeaders(ctx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ hidden: true }),
    });
  },

  async unhide(ctx, comment): Promise<void> {
    await socialFetch(`${API_BASE}/tweets/${comment.externalId}/hidden`, {
      platform: 'x',
      method: 'PUT',
      headers: { ...authHeaders(ctx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ hidden: false }),
    });
  },

  async delete(ctx, comment): Promise<void> {
    await socialFetch(`${API_BASE}/tweets/${comment.externalId}`, { platform: 'x', method: 'DELETE', headers: authHeaders(ctx.accessToken) });
  },
};
