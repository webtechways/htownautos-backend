---
name: social-suite-b4-community-patterns
description: Community adapter interface (comments/mentions/reviews), platformAccountId formats per platform, permission-error-disables-poll pattern
metadata:
  type: project
---

Built package B4/B6 "Community" (comments, mentions, reviews) of the Social Suite on `feat/social-suite`, mirroring B2's `SocialPublisher` pattern but for the read+moderate direction. Files: `libs/social/src/community/**` (9 adapters: facebook/instagram/threads/youtube/linkedin/bluesky/mastodon/x/gbp — no TikTok, no Pinterest), `apps/data-sync/src/social/community-jobs/community-poll.service.ts`, `apps/api/src/social/comments/**`.

## CommunityAdapter interface (mirrors `SocialPublisher` in `libs/social/src/publish/types.ts`)
`fetchSince(ctx, {postExternalIds, since}) → {items: NormalizedComment[], cursor}` is required; `reply`/`like`/`unlike`/`hide`/`unhide`/`delete` are all **optional and omitted entirely** (not no-ops) per platform — callers check `typeof adapter.reply === 'function'`. `postExternalIds` (our own `SocialPostTarget.externalId`s, most recent 25) only matters for per-post comment APIs (Facebook, Instagram, Threads, LinkedIn); account-level platforms (YouTube `allThreadsRelatedToChannelId`, Bluesky `listNotifications`, Mastodon/X mentions, GBP reviews) ignore it.

## `SocialAccount.platformAccountId` format per platform (confirmed by grepping `libs/social/src/connect/platforms/*.ts`)
- youtube: channel id · gbp: `accounts/{a}/locations/{l}` full resource name · mastodon: numeric account id (host lives in `secrets.instance`, NOT platformAccountId) · x: numeric user id string · bluesky: DID · linkedin: `profile.sub` (person) or numeric org id (organization) — same `authorUrn()` split used in `linkedin.publisher.ts`.

## Cursor storage — no schema change
`SocialAccount.metaValue.commentsSince` — ISO timestamp for time-based platforms, but Mastodon/X page by id only, so `cursor` there is the last-seen status/tweet id (string), not a date. `FetchSinceResult.cursor` is typed as opaque `string` for exactly this reason — don't assume it parses as a Date.

## Permission-error-disables-poll pattern
LinkedIn (missing Community Management API approval) and X (mentions needs a paid tier) both 403 forever once misconfigured. `CommunityPollService.pollAccount` catches `SocialApiError` with `kind === 'PERMISSION'`, logs once, and sets `metaValue.commentsPollDisabledAt` — subsequent polls skip the account until it's reconnected (which overwrites `metaValue`). The comments-list mapper (`apps/api/src/social/comments/mappers.ts`) also reads this flag to force `canReply`/`canLike`/`canHide`/`canDelete` to false, so the UI doesn't offer actions during that window either.

## GBP review "reply" collides with the review's own externalId
Google Business Profile replies go through the SAME resource name as the review (`PUT .../reviews/{id}/reply`) — there's no separate reply id. Since `SocialComment` is unique on `(accountId, externalId)`, `comments.service.ts`'s `reply()` suffixes a synthetic id (`${result.externalId}:reply:${Date.now()}`) when `adapter.reply()` returns the same externalId as the parent, so our own reply still gets its own row instead of colliding.

## Extracted pure functions for testability, mirroring B2/B3
`apps/api/src/social/comments/stats.ts` (`computeCommentScore`) and `gbp.reviews.ts`'s `toNormalized` are both exported plain functions specifically so `jest` fixtures don't need a mocked PrismaService or HTTP layer — same pattern as `publisher/backoff.ts`/`post-status.ts`.
