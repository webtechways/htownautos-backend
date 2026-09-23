---
name: social-suite-b7-insights-patterns
description: Metrics adapter registry pattern, overview aggregation design, interactive-vs-cron duplication, start-page slug/media patterns for Social Suite package B7 (Insights + Start Pages)
metadata:
  type: project
---

Built 2026-09-23 on `feat/social-suite`, package B7 (`apps/api/src/social/{insights,start-pages}`, `apps/public-start`, `libs/social/src/insights/**`, data-sync `insights-jobs`).

## Metrics adapter registry mirrors `community/` exactly
`libs/social/src/insights/<platform>.metrics.ts` implements `MetricsAdapter { accountDaily(ctx, date), postMetrics(ctx, target) }`, same shape as `CommunityAdapter` in `libs/social/src/community/types.ts`. `registry.ts` exports `metricsAdapterFor(platform)`. WhatsApp has no entry (messaging only). A platform whose API has no daily-partitioned data (TikTok, YouTube, Facebook fan_count, LinkedIn org followers) gets a **snapshot-of-lifetime-total pattern**: call the "current totals" endpoint every day and let the upserted row represent that day's snapshot — this is intentional, not a shortcut, and is documented in each adapter's file comment.

## Errors: throw by default, LinkedIn is the one exception
Every adapter lets `SocialApiError` propagate (community-poll style: the *caller* — data-sync's cron or the api's interactive sync — catches per-account/per-target and skips, never writing a row for that failure). **LinkedIn is the only adapter that catches `PERMISSION` errors internally** and returns an all-null result instead of throwing, because org stats need Community Management API approval that most tenants will never have — throwing would just retry-spam forever. This was an explicit brief requirement; don't copy the "catch PERMISSION → nulls" behavior to other platforms without a similar justification.

## `engagements = likes+comments+shares+saves` lives in one place
`libs/social/src/insights/engagement.ts` (`sumEngagements`, `engagementRate`) is the single definition used by every adapter's `postMetrics` AND by the api's overview aggregation (`apps/api/src/social/insights/metrics-view.util.ts`'s `targetEngagements`). Never recompute this formula ad hoc — import it.

## Interactive sync duplicates the cron job's snapshot logic (by design)
`apps/api` and `apps/data-sync` are separate deployable apps — api code cannot import data-sync services. `POST /social/insights/sync` (`SocialInsightsService.snapshotAccount`) and the data-sync cron (`SocialMetricsJobsService.snapshotAccount`) are two independent ~15-line copies of the same upsert logic. This mirrors the existing precedent `SocialFeedsService.refresh` (api) running the feed fetch inline instead of round-tripping through a queue — the "interactive refresh" pattern for this codebase, not a mistake to dedupe later.

## Overview aggregation extracted to a pure function for testability
`apps/api/src/social/insights/overview.util.ts`'s `buildOverview(range, accountIds, accounts, dailyRows, targets)` takes already-fetched Prisma rows and returns the `InsightsOverview` shape with zero DB access — `insights.service.ts` just does the 3 `findMany`s and calls it. Do this split whenever a service method's *aggregation math* is the part worth unit-testing, not the Prisma query itself (same reasoning applied to `best-times.util.ts`'s `computeBestTimes`).

## `SocialAccountMetricDaily`/`SocialStartPageStat` upsert keys
Compound unique constraints become Prisma's `<field1>_<field2>[...]` key name automatically: `@@unique([accountId, date])` → `accountId_date`; `@@unique([pageId, date, blockId])` → `pageId_date_blockId`. Both tables store `date` as `@db.Date` — always construct the `Date` at UTC midnight (`new Date(\`${dateStr}T00:00:00Z\`)`) before using it in a `where`/`create`, or the upsert silently creates a duplicate row a few hours off.

## Start page slug: format+reserved in a pure util, uniqueness against the DB
`apps/api/src/social/start-pages/slug.util.ts` (`isValidSlugFormat`, `isReservedSlug`, `validateSlugShape` throwing 400, `slugify`) has zero DB access — jest-testable directly. `SocialStartPage.slug` is `@unique` **globally** (not per-tenant) per the frozen schema, matching the contract's "globally unique" comment — uniqueness check is a bare `findUnique({ where: { slug } })`, no `tenantId` filter.

## Public page media TTL is 24h, not the library default 1h
`MediaResolverService.signedUrl(media, ttlSec)` defaults to `DEFAULT_TTL_SEC = 3600`. `posts/mappers.ts`'s `resolveMediaMap` helper hardcodes that default (calls `signedUrl(row)` with no ttl arg) — **don't reuse `resolveMediaMap` for the public start page**, since the contract requires 24h URLs there. `public-start.service.ts` resolves media itself with an explicit `24 * 60 * 60` ttl instead.

## Instagram Graph insights: `impressions` is retired, use `views`
Graph API v22+ (this repo defaults `META_GRAPH_VERSION=v23.0`) deprecated the `impressions` metric for both `/{ig-user-id}/insights` and `/{ig-media-id}/insights`; the replacement is `views`. A single invalid metric name in the `metric=` CSV fails the WHOLE insights call, so keep the requested metric list conservative (only long-stable names) rather than throwing in extra ones speculatively.

See also [[social-suite-b4-community-patterns]] for the `CommunityAdapter` pattern this package's `MetricsAdapter` mirrors, and [[social-suite-b2-patterns]] for the "one line in providers" DI trick used in every new module here.
