# Agent Memory Index

- [PrismaService wrapper pattern](prisma-service-pattern.md) — PrismaService exposes explicit getters, new models need manual additions
- [Auth guard architecture](auth-guard-arch.md) — Global guards, portal customer auth pattern, staff vs customer distinction
- [Portal tenant constant](portal-tenant.md) — Canonical portal tenant ID and design decisions
- [Best-effort Clerk linking pattern](feedback-best-effort-clerk.md) — Clerk account creation on buyer create/update must never block staff workflow
- [Prisma Json field typing](prisma-json-field-typing.md) — Record<string, unknown> must be cast to Prisma.InputJsonValue for Json columns
- [Copart sync patterns](copart-sync-patterns.md) — csv-parse options, SyncRun progress fields, phase throttling, status endpoint location
- [Jest and tsc verification](jest-and-tsc-verification.md) — root jest config quirks; tsconfig.app.json include globs type-check all of libs/**, poisons naive baseline comparisons
- [Nx new lib and global modules](nx-new-lib-and-global-modules.md) — minimal libs/<name> Nx lib template; sharing one @Global() service instance across consumers
- [Social Suite B2 patterns](social-suite-b2-patterns.md) — "one line in providers" DI trick, S3Service key limitations, contract.ts union vs TS enum, OAuth state nonce peeking, which modules are @Global()
- [Social Suite B3 patterns](social-suite-b3-patterns.md) — Buffer-vs-BodyInit TS cast, Google 308 resumable-upload trap, FOR UPDATE SKIP LOCKED claim pattern, thread root+parent design, extending PublishContext instead of touching frozen files
- [Social Suite B4 community patterns](social-suite-b4-community-patterns.md) — CommunityAdapter interface, platformAccountId formats, permission-error-disables-poll, GBP reply externalId collision
- [Social Suite B7 insights patterns](social-suite-b7-insights-patterns.md) — MetricsAdapter registry, engagement formula, interactive-sync-duplicates-cron by design, slug/media TTL details
- [Global guard DI crash-loop](global-guard-di-crashloop.md) — never add a new constructor dep to ClerkJwtGuard/CustomerGuard (30+ modules use @UseGuards locally without AuthModule); instantiate createClerkClient at module scope instead; boot-test recipe
- [Identity sync B1+B4](identity-sync-b1-b4.md) — User.userType/AllowCustomer/recomputeUserType/CustomerGuard resolution order; CLERK-SYNC-DESIGN.md is the source of truth
- [Identity sync B2](identity-sync-b2.md) — CRM→Clerk push: ensureUserForBuyer/syncUserOnBuyerRemoved, identity.clerk.push queue, data-sync consumer, sweep, Clerk SDK call shapes
- [Identity sync B3](identity-sync-b3.md) — Clerk→CRM webhooks: clerk_webhook_events idempotent store, ClerkEventsConsumer, User.email NOT NULL gap for SMS-only signup, STAFF-ban safety fix in B2's push consumer
- [Identity sync B5](identity-sync-b5.md) — backfill/reprocess scripts, PrismaService-outside-DI pattern, synthetic-email-never-pushed-to-Clerk guard, placeholder masking in BuyerEntity/portal mapper
