---
name: identity-sync-b2
description: CRM -> Clerk identity push (CLERK-SYNC-DESIGN.md package B2) — ensureUserForBuyer/syncUserOnBuyerRemoved, identity.clerk.push queue, data-sync consumer, sweep cron, Clerk backend SDK call shapes confirmed via source. Shipped 2026-09-24 on branch feat/identity-sync-2.
metadata:
  type: project
---

Design doc: `docs/identity/CLERK-SYNC-DESIGN.md`. Builds on [[identity-sync-b1-b4]] (schema + guards already in main).

## Producer side (api)
- `libs/auth/src/identity-sync-helpers.ts` — plain functions (not injectable, mirrors [[recompute-user-type]]'s pattern), take `PrismaService` as a param: `ensureUserForBuyer` (buyer create/update) and `syncUserOnBuyerRemoved` (buyer remove). Both best-effort, never throw.
- `ensureUserForBuyer` match order: `Buyer.userId` if already set → normalised email (case-insensitive) → E.164 phone → create. **On first-time match/link (not create)**, does NOT overwrite the matched User's name/phone/email — only the trailing `clerkSyncStatus` write touches it. Only a User that's *already* linked (`buyer.userId` was set coming in) gets its firstName/lastName/phoneNumber refreshed on subsequent edits. Judgment call: protects a staff member's own User row from being clobbered by a Buyer row that happens to share their email.
- `User.email` is never touched once linked — that's the Clerk-verified login identity; design decision 4 (staff-changes-login-email = permission+audit+notice) is out of scope for B2, not implemented.
- Non-portal tenant → still creates/links a `User` (CUSTOMER unless it's STAFF via existing match) but `clerkSyncStatus=SKIPPED`, never publishes. No email → SKIPPED `no_email`, no User created if none existed.
- Callers: `apps/api/src/buyers/buyers.service.ts` (create/update/remove/removeBulk — private helpers `enqueueIdentitySync`/`enqueueIdentitySyncOnRemoval`) and `apps/api/src/portal/portal.service.ts` `updateProfile`. Both inject `RabbitMQService` directly in the constructor — safe because `RabbitMQModule` is `@Global()`, no module import needed (confirmed pattern already used by `auction-calendar-alerts.service.ts`).
- Queue contract: `libs/rabbitmq/src/identity-clerk-push.ts` — `CLERK_PUSH_QUEUE = 'identity.clerk.push'`, message is just `{ userId }`. Message-minimal by design: the consumer always rereads fresh state.
- Tiny status API: `GET /buyers/:id/portal-access` → `{status, error, clerkUserId, syncedAt}` (status `'NOT_LINKED'` when `Buyer.userId` is null), `POST /buyers/:id/portal-access/retry` → re-enqueues via the same `ensureUserForBuyer` path (re-checks `customerPortalEnabled` fresh, so it's safe to call on any buyer).

## Consumer side (data-sync)
- `apps/data-sync/src/identity/` — `IdentityClerkPushConsumer` (prefetch 1, idempotent — rereads User+Buyers fresh every message, hashes desired state, skips Clerk calls when hash unchanged), `IdentitySyncSweepService` (`@Cron(EVERY_5_MINUTES)`, re-publishes PENDING > 2min and FAILED with `2^attempts` min backoff capped at 240min, up to `MAX_CLERK_SYNC_ATTEMPTS=8`), `IdentityQuotaNotifierService` (Notification+chat alert, deduped 1h via `findFirst` on recent `CLERK_QUOTA_EXCEEDED` rows — no dedicated "already notified" column, reused the existing table).
- **Known gap**: the sweep's staleness/backoff clock uses `User.updatedAt` (schema has no dedicated `clerkSyncQueuedAt`) — ANY unrelated update to the User row (e.g. a future login-activity write) resets it. Low risk today (checked `ClerkJwtGuard` — it only writes to `User` on first-time linking, not on every request) but worth a real column if that changes.
- `libs/auth/src/clerk-admin.client.ts` — plain `createClerkAdminClient()` factory (mirrors `customer.guard.ts`'s module-scope `createClerkClient` trick, see [[global-guard-di-crashloop]]). data-sync imports named exports from `@htownautos/auth` (this factory, `PORTAL_TENANT_ID`, `ensureUserForBuyer`) — fine, only the `AuthModule` class itself (which registers `APP_GUARD`s) must never be imported/added to a data-sync module's `imports`.
- Ban path (buyer removed, no portal buyers left for that User): `clerk.users.banUser(clerkUserId)` if linked, else no-op; either way → `SKIPPED`. Never a hard delete.
- Link-by-email/phone uses `clerk.users.getUserList({emailAddress:[e]})` / `{phoneNumber:[p]}` (exact-match arrays, NOT the `query` fuzzy param) then `updateUser` — **never** touches `password` (that's exactly the P0 account-takeover vector `ClerkService.createUser` was hotfixed for).
- Email/phone sync on an existing linked Clerk user: create + `primaryEmailAddressID`/`primaryPhoneNumberID` — the *old* identity is deliberately left in place (never deleted) per the design's "keep old until new is set".

## `@clerk/backend` SDK shapes (confirmed via `node_modules/@clerk/backend/dist/api/**/*.d.ts` + Context7, v2.x as of 2026-09):
- `clerkClient.users.getUserList({emailAddress?: string[], phoneNumber?: string[], ...})` → `{data: User[], totalCount: number}`.
- `clerkClient.users.createUser({externalId?, emailAddress?: string[], phoneNumber?: string[], firstName?, lastName?, skipPasswordRequirement?, publicMetadata?, ...})`.
- `clerkClient.users.updateUser(userId, {firstName?, lastName?, primaryEmailAddressID?, primaryPhoneNumberID?, externalId?, ...})` — note the param is `primaryEmailAddressID` (capital ID), not `primaryEmailAddressId`.
- `clerkClient.users.updateUserMetadata(userId, {publicMetadata?, privateMetadata?, unsafeMetadata?})` — deep-merges, `null` deletes a key.
- `clerkClient.users.banUser(userId)` / `unbanUser(userId)` — no params beyond the id.
- `clerkClient.emailAddresses.createEmailAddress({userId, emailAddress, verified?, primary?})`, `clerkClient.phoneNumbers.createPhoneNumber({userId, phoneNumber, verified?, primary?})`.
- `User` resource: `emailAddresses: EmailAddress[]`, `phoneNumbers: PhoneNumber[]`, `primaryEmailAddressId`, `primaryPhoneNumberId` (lowercase `Id` on the *read* side, capital `ID` on *write* params — easy to typo).
- Errors: `ClerkAPIResponseError` has `status`, `errors: [{code, message, longMessage, meta:{paramName}}]`. No confirmed exact code for the dev-instance 100-user quota cap — `apps/data-sync/src/identity/clerk-error.util.ts` classifies heuristically (status 429 or any error code matching `/quota/i`) and flagged as unverified against a real dev instance in the B2 handback report.
