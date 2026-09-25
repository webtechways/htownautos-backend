# Customers as Clerk users — bidirectional sync (design, lead-architect, 2026-09-24)

## Evidence (prod, 2026-09-24)
8 buyers (all with email+phone), 3 linked to Clerk, all in the portal tenant `50197477…`; 6 buyers share email with an active staff user. 7 `users`. Clerk key is `sk_test` → **prod uses a DEVELOPMENT Clerk instance (100-user cap)**. 3/6 `users.clerkUserId` and 1/3 `buyers.clerk_user_id` point to deleted Clerk users. One staff user re-linked 8 times to 5 Clerk ids (ClerkJwtGuard overwrote clerkUserId).

## P0 holes (hotfix branch `fix/p0-clerk-identity`)
1. Guards trust unsigned `X-Clerk-User` email → relink existing rows → account takeover.
2. `CustomerGuard.mergeEmailDuplicates` can hand another customer's Buyer.
3. Clerk webhook has no svix verification → forged `organizationMembership.created` = owner.
4. `ClerkService.createUser → handleExistingUser` resets passwords of existing Clerk users (reachable from buyer create + invitations).

## Design
- `User` = the single identity (1 Clerk user = 1 User). `enum UserType {STAFF CUSTOMER}`; STAFF iff ≥1 active TenantUser.
- `User`: `clerkSyncStatus (PENDING|SYNCED|FAILED|SKIPPED)`, `clerkSyncAttempts`, `clerkSyncedAt`, `clerkSyncError`, `clerkSyncHash`, `clerkEventAt`.
- `Buyer.userId` FK→User SetNull, `@@unique([tenantId,userId])`; `Buyer.clerkUserId` kept read-only one release, then dropped.
- `Tenant.customerPortalEnabled` (true only for HtownAutos).
- `clerk_webhook_events` (svix-id PK, type, payload, processedAt, attempts, error).
- Field ownership: `User.email` = login email (Clerk wins, verified); `Buyer.email` = contact (CRM wins); names last-writer-wins by event time; avatar Clerk→CRM only; phone CRM only.
- Clerk `publicMetadata` (backend-only): `{userType, customerTenantIds, crmUserId}`, `externalId = User.id`. **Authorization always from the DB, never metadata.**
- CRM→Clerk: buyer create/update in a portal tenant → User PENDING → after commit publish `identity.clerk.push {userId}`; data-sync consumer (prefetch 1, idempotent via hash): link by email **without touching password** or create with `skipPasswordRequirement` + `externalId`. Sweep every 5 min for PENDING>2 min / FAILED (backoff, max 8).
- Clerk→CRM: svix-verified controller → insert event (ON CONFLICT DO NOTHING) → `identity.clerk.events` → 200. `user.created` upsert (+ Buyer in portal tenant if `unsafeMetadata.signupSource==='web'`), `user.updated` in-order + hash differs, `user.deleted` → null clerkUserId + SKIPPED (keep Buyer), membership changes → recompute userType + metadata. Loop guard: hash of last push, Clerk-originated writes never enqueue a push, stale events dropped.
- Security: `TenantGuard` rejects CUSTOMER with `STAFF_ONLY` except portal + invitation routes (`@AllowCustomer()`), checked before the `TenantOptional` early return.
- Failures: email in use → FAILED `email_in_use`; no email → SKIPPED; quota → FAILED `user_quota_exceeded` + alert.
- `CLERK_SYNC_ENABLED` only in Coolify (dev and prod share the DB).

## Packages
B1 schema (one additive migration + `customer_portal_enabled` UPDATE + lower(trim()) user emails) · B2 CRM→Clerk (own Clerk admin client in `libs/auth/src/clerk-admin.client.ts`, don't import AuthModule in data-sync) · B3 Clerk→CRM · B4 guards (`userType` in AuthenticatedUser, STAFF_ONLY, recomputeUserType) · B5 backfill script (`--dry-run/--apply`, batches of 10, 200 ms) · F1 buyer "Portal access" badge + Retry/Send access + STAFF_ONLY screen · W1 web `<SignUp unsafeMetadata={{signupSource:'web'}} />` · CI/CD: `CLERK_WEBHOOK_SIGNING_SECRET`, `CLERK_SYNC_ENABLED=true`; user registers the Clerk webhook endpoint (`user.*`, `organizationMembership.*`).

## User decisions (defaults recommended by the lead)
1. Clerk login only for customers of portal tenants (HtownAutos) — others CUSTOMER users SKIPPED.
2. CRM-created customer: silent creation, no email; "Send portal access" button.
3. Passwordless email code login.
4. Staff changing a linked customer's email also changes the Clerk login email (permission + audit + notice to old email).
5. Deleting a customer in the CRM bans in Clerk (reversible); hard delete separate, admin only.
6. Customers can't create tenants.
7. Migrate to a Clerk PRODUCTION instance before backfill/portal opening (separate project).
8. Web sign-up creates a CRM lead immediately (`source='web-signup'`).
9. No phone/SMS login in Clerk.

## User answers (2026-09-24) — these override the defaults above
- (2) Silent creation, no email; "Send portal access" button. ✔ default
- (3) Login: **email code AND SMS code** (user chose "también por SMS"). Consequence: phone is a login identifier → CRM phone (E.164) is pushed to Clerk as `phone_number`; phone changes sync both ways like email (Clerk verified phone wins for login, Buyer.phone stays the contact phone); enable SMS code in the Clerk dashboard (SMS may cost). Decision 9 is reversed.
- (7) Clerk production instance: **later**. Stay on the dev instance for now → hard cap 100 users: surface `user_quota_exceeded` loudly; today there are 8 buyers.
- (5) Delete in CRM → **ban in Clerk (reversible)**. ✔ default
- Others (1, 4, 6, 8) take the lead's defaults.
