---
name: global-guard-di-crashloop
description: Adding ANY new constructor dependency to ClerkJwtGuard or CustomerGuard crash-loops the API — confirmed by booting the compiled dist with a dummy DB
metadata:
  type: project
---

`ClerkJwtGuard` is registered globally via `APP_GUARD` in `libs/auth/src/auth.module.ts`, but ~30+ controllers across `apps/api/src/**` ALSO apply `@UseGuards(ClerkJwtGuard)` at the class or method level (pre-existing, legacy from before the guard became global — grep `UseGuards(ClerkJwtGuard` to see the current list: vehicle-inspections, image-cache, portal-settings, auction-calendar, auction-monitor, auction-history, scraper-agents/workers, yards, title-mapping, favorites, listing-*, buyer-*, twilio, presence, rebuild, new-lots-stats, inspection-share-links, opensearch/auction-search...). Each of those modules only imports `PrismaModule` (because that's ClerkJwtGuard's only current dependency besides `Reflector`, which is always available) — they do NOT import `@htownautos/auth`'s `AuthModule`.

**Consequence confirmed by booting `dist/apps/api/apps/api/src/main.js` with a dummy env**: adding a new constructor param to `ClerkJwtGuard` (tried injecting `ClerkService`) immediately threw `UnknownDependenciesException` on boot — `Nest can't resolve dependencies of the ClerkJwtGuard (Reflector, PrismaService, ?)` — in the FIRST module found using the guard locally (was `AuctionHistoryModule` in one run). This is exactly the CLAUDE.md-documented crash-loop anti-pattern, but the trigger here is subtler: it's not `@UseGuards` itself causing it, it's a **new constructor dependency added later** to a guard that's already safely used in dozens of places with a narrower dependency footprint.

**Fix pattern used**: don't inject new services via Nest DI into `ClerkJwtGuard` or `CustomerGuard`. Instead instantiate `createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! })` at module scope (top of the guard file, outside the class) and call `clerkClient.users.getUser(...)` directly. Same trick already existed in `clerk-webhooks.controller.ts` (inline `require('@clerk/backend')`) and is now used in both guards. `CustomerGuard` is provided only in `PortalModule`, same story — its module doesn't import `AuthModule`/`ClerkService` either.

**Verification recipe for any future guard change**: `npx nx run-many --target=build`, then boot the compiled JS directly with dummy env vars (`DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`, `REDIS_URL`) in the background, `sleep 8-10`, grep the log for `"Nest can't resolve"` / `UnknownDependenciesException`, then `pkill -f main.js`. A clean run reaches ~100+ "dependencies initialized" lines and only fails later at the DB-connection step (expected, since the DB is fake). `npx tsc --noEmit` and `nx build` do NOT catch this — it's a pure runtime DI-graph error.

Related: [[auth-guard-arch]]
