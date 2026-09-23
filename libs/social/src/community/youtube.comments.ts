import { socialFetch } from '../http/social-http';
import type { NormalizedComment } from '../ingest/social-ingest.service';
import type { CommunityAdapter, CommunityActionContext, FetchSinceOptions, FetchSinceResult, ReplyResult } from './types';

const BASE = 'https://www.googleapis.com/youtube/v3';
const MAX_PAGES = 5;

interface YtCommentSnippet {
  textDisplay: string;
  authorDisplayName: string;
  authorProfileImageUrl?: string;
  authorChannelId?: { value?: string };
  publishedAt: string;
  parentId?: string;
  videoId?: string;
}

interface YtComment {
  id: string;
  snippet: YtCommentSnippet;
}

interface YtCommentThread {
  id: string;
  snippet: {
    videoId: string;
    topLevelComment: YtComment;
    totalReplyCount: number;
  };
  replies?: { comments: YtComment[] };
}

interface YtCommentThreadsPage {
  items: YtCommentThread[];
  nextPageToken?: string;
}

function toNormalized(tenantId: string, accountId: string, videoId: string, comment: YtComment): NormalizedComment {
  return {
    tenantId,
    accountId,
    platform: 'youtube',
    kind: 'comment',
    externalId: comment.id,
    externalParentId: comment.snippet.parentId ?? null,
    externalPostId: videoId,
    authorName: comment.snippet.authorDisplayName,
    authorHandle: null,
    authorAvatarUrl: comment.snippet.authorProfileImageUrl ?? null,
    authorExternalId: comment.snippet.authorChannelId?.value ?? null,
    body: comment.snippet.textDisplay,
    permalink: `https://www.youtube.com/watch?v=${videoId}&lc=${comment.id}`,
    fromUs: false,
    platformCreatedAt: new Date(comment.snippet.publishedAt),
  };
}

/** YouTube channel comment threads (CONTRACT.md §1/§4) — 5 min poll, account-level (`allThreadsRelatedToChannelId`). */
export const youtubeCommentsAdapter: CommunityAdapter = {
  async fetchSince(ctx: CommunityActionContext, opts: FetchSinceOptions): Promise<FetchSinceResult> {
    const items: NormalizedComment[] = [];
    const sinceTs = opts.since ? new Date(opts.since).getTime() : 0;
    let maxTs = sinceTs;
    let pageToken: string | undefined;
    let stop = false;

    for (let page = 0; page < MAX_PAGES && !stop; page++) {
      const url = new URL(`${BASE}/commentThreads`);
      url.searchParams.set('part', 'snippet,replies');
      url.searchParams.set('allThreadsRelatedToChannelId', ctx.account.platformAccountId);
      url.searchParams.set('order', 'time');
      url.searchParams.set('maxResults', '100');
      url.searchParams.set('textFormat', 'plainText');
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const res = await socialFetch(url.toString(), { platform: 'youtube', headers: { Authorization: `Bearer ${ctx.accessToken}` } });
      const data = (await res.json()) as YtCommentThreadsPage;

      for (const thread of data.items ?? []) {
        const top = thread.snippet.topLevelComment;
        const topTs = new Date(top.snippet.publishedAt).getTime();
        if (topTs <= sinceTs) {
          stop = true;
          break;
        }
        items.push(toNormalized(ctx.account.tenantId, ctx.account.id, thread.snippet.videoId, top));
        maxTs = Math.max(maxTs, topTs);
        for (const reply of thread.replies?.comments ?? []) {
          const replyTs = new Date(reply.snippet.publishedAt).getTime();
          if (replyTs <= sinceTs) continue;
          items.push(toNormalized(ctx.account.tenantId, ctx.account.id, thread.snippet.videoId, reply));
          maxTs = Math.max(maxTs, replyTs);
        }
      }

      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }

    return { items, cursor: new Date(maxTs || Date.now()).toISOString() };
  },

  async reply(ctx, comment, text): Promise<ReplyResult> {
    const url = new URL(`${BASE}/comments`);
    url.searchParams.set('part', 'snippet');
    const res = await socialFetch(url.toString(), {
      platform: 'youtube',
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ snippet: { parentId: comment.externalId, textOriginal: text } }),
    });
    const data = (await res.json()) as { id: string };
    return { externalId: data.id, permalink: null };
  },

  /** "hide" maps to YouTube's moderation status (CONTRACT.md: "reply; setModerationStatus = hide"). */
  async hide(ctx, comment): Promise<void> {
    const url = new URL(`${BASE}/comments/setModerationStatus`);
    url.searchParams.set('id', comment.externalId);
    url.searchParams.set('moderationStatus', 'rejected');
    await socialFetch(url.toString(), { platform: 'youtube', method: 'POST', headers: { Authorization: `Bearer ${ctx.accessToken}` } });
  },

  async unhide(ctx, comment): Promise<void> {
    const url = new URL(`${BASE}/comments/setModerationStatus`);
    url.searchParams.set('id', comment.externalId);
    url.searchParams.set('moderationStatus', 'published');
    await socialFetch(url.toString(), { platform: 'youtube', method: 'POST', headers: { Authorization: `Bearer ${ctx.accessToken}` } });
  },

  async delete(ctx, comment): Promise<void> {
    const url = new URL(`${BASE}/comments`);
    url.searchParams.set('id', comment.externalId);
    await socialFetch(url.toString(), { platform: 'youtube', method: 'DELETE', headers: { Authorization: `Bearer ${ctx.accessToken}` } });
  },
};
