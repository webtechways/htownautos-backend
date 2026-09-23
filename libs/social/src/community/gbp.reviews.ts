import { socialFetch } from '../http/social-http';
import type { NormalizedComment } from '../ingest/social-ingest.service';
import type { CommunityAdapter, CommunityActionContext, FetchSinceOptions, FetchSinceResult, ReplyResult } from './types';

/** `reviews` still lives on the legacy My Business API v4 (same as `gbp.publisher.ts`'s `localPosts`). */
const BASE = 'https://mybusiness.googleapis.com/v4';
const MAX_PAGES = 5;

const STAR_RATING: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export interface GbpReview {
  reviewId: string;
  reviewer?: { displayName?: string; profilePhotoUrl?: string };
  starRating?: keyof typeof STAR_RATING;
  comment?: string;
  createTime: string;
  updateTime: string;
  name: string; // "accounts/*/locations/*/reviews/*"
}

interface GbpReviewsPage {
  reviews?: GbpReview[];
  nextPageToken?: string;
}

export function toNormalized(tenantId: string, accountId: string, review: GbpReview): NormalizedComment {
  return {
    tenantId,
    accountId,
    platform: 'gbp',
    kind: 'review',
    externalId: review.name,
    externalParentId: null,
    externalPostId: null,
    authorName: review.reviewer?.displayName ?? 'Google user',
    authorHandle: null,
    authorAvatarUrl: review.reviewer?.profilePhotoUrl ?? null,
    authorExternalId: null,
    body: review.comment ?? '',
    permalink: null,
    rating: review.starRating ? (STAR_RATING[review.starRating] ?? null) : null,
    fromUs: false,
    platformCreatedAt: new Date(review.updateTime || review.createTime),
  };
}

/** Google Business Profile reviews (CONTRACT.md §1/§4) — 5 min poll, per location (`account.platformAccountId`). */
export const gbpReviewsAdapter: CommunityAdapter = {
  async fetchSince(ctx: CommunityActionContext, opts: FetchSinceOptions): Promise<FetchSinceResult> {
    const items: NormalizedComment[] = [];
    const sinceTs = opts.since ? new Date(opts.since).getTime() : 0;
    let maxTs = sinceTs;
    let pageToken: string | undefined;
    let stop = false;

    for (let page = 0; page < MAX_PAGES && !stop; page++) {
      const url = new URL(`${BASE}/${ctx.account.platformAccountId}/reviews`);
      url.searchParams.set('pageSize', '50');
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const res = await socialFetch(url.toString(), { platform: 'gbp', headers: { Authorization: `Bearer ${ctx.accessToken}` } });
      const data = (await res.json()) as GbpReviewsPage;

      for (const review of data.reviews ?? []) {
        const ts = new Date(review.updateTime || review.createTime).getTime();
        if (ts <= sinceTs) {
          stop = true;
          continue;
        }
        items.push(toNormalized(ctx.account.tenantId, ctx.account.id, review));
        maxTs = Math.max(maxTs, ts);
      }

      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }

    return { items, cursor: new Date(maxTs || Date.now()).toISOString() };
  },

  /** Only OUR reply to the review, not the review itself — GBP gives businesses no way to delete a customer's review. */
  async reply(ctx, comment, text): Promise<ReplyResult> {
    const url = `${BASE}/${comment.externalId}/reply`;
    await socialFetch(url, {
      platform: 'gbp',
      method: 'PUT',
      headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: text }),
    });
    return { externalId: comment.externalId, permalink: null };
  },
};
