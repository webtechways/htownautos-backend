---
name: identity-sync-b1-b4
description: Customer<->Clerk identity sync (CLERK-SYNC-DESIGN.md) — User.userType, AllowCustomer decorator, recomputeUserType, CustomerGuard resolution order. Shipped B1+B4 on 2026-09-24.
metadata:
  type: project
---

Design doc: `docs/identity/CLERK-SYNC-DESIGN.md` (lead-architect, dated 2026-09-24, includes user decisions that override the doc's own defaults — always read to the end).

## Schema (B1) — migration `20260924120000_clerk_identity_sync_b1`
- `User.userType` enum `UserType {STAFF CUSTOMER}` `@default(STAFF)`. **Ground truth**: STAFF iff >=1 active TenantUser (`isActive: true, status: 'active'`). Never trust it as authorization for a *specific* tenant — TenantGuard's own membership check still does that; userType only gates whether a route accepts a customer identity at all.
- `User.clerkSyncStatus/clerkSyncAttempts/clerkSyncedAt/clerkSyncError/clerkSyncHash/clerkEventAt` — reserved for B2/B3 (CRM<->Clerk push/pull sync), not populated yet by anything in B1/B4.
- `Buyer.userId` -> `User.id`, `onDelete: SetNull`, `@@unique([tenantId, userId])` (nullable-safe: most staff-created buyers never log in, NULL doesn't collide).
- `Tenant.customerPortalEnabled` (`@map("customer_portal_enabled")`) — only true for the HtownAutos portal tenant (`50197477-9e89-4465-bed5-99c638c435a0`) today.
- `ClerkWebhookEvent` (`@@map("clerk_webhook_events")`) — PK is the svix-id (text, never generated locally), for B3's idempotent webhook processing.
- User model fields are camelCase-unmapped by convention (no per-field `@map`) except pre-existing snake_case ones like `clerk_org_id`/`clerk_user_id`. New User/Buyer columns follow the unmapped camelCase convention; Tenant.customerPortalEnabled got an explicit `@map` because the brief named the exact prod column name.
- `User` already had `phoneNumber String?` before this migration — do NOT add a duplicate `phone` field for SMS-login work; reuse `phoneNumber`.

## Guards (B4)
- `@AllowCustomer()` decorator (`libs/auth/src/decorators/allow-customer.decorator.ts`, key `ALLOW_CUSTOMER_KEY`) — the *whitelist* for CUSTOMER-type users. Default is deny.
- `TenantGuard.canActivate` order (deliberately, see design doc): (1) `if (!user) return true` (unauthenticated / `@Public()`), (2) STAFF_ONLY check — CUSTOMER without `@AllowCustomer()` throws `ForbiddenException({code: 'STAFF_ONLY', statusCode: 403})`, (3) THEN the `tenantOptional` early return. Order matters: `@TenantOptional()` alone (e.g. `tenants/my-tenants`) must NOT let a customer through — only `@AllowCustomer()` does.
- Routes marked `@AllowCustomer()`: `PortalController` (class-level, alongside its existing `@TenantOptional() @UseGuards(CustomerGuard)`), and in `tenant.controller.ts`: `GET tenants/me/invitations`, `POST tenants/me/invitations/:tenantUserId/accept`, `POST tenants/me/invitations/:tenantUserId/decline`. The separate `POST /invitations/accept` (different controller, code-based) was deliberately left unmarked — brief scoped `@AllowCustomer()` to `me/invitations*` only.
- `recomputeUserType(prisma, userId)` in `libs/auth/src/recompute-user-type.ts` — plain function (not injectable, avoids the guard DI crash-loop, see [[global-guard-di-crashloop]]), takes a minimal structural type satisfied by both `PrismaService` and `Prisma.TransactionClient` so it can run inside an existing tx. Best-effort: logs + returns `null` on error, never throws (auth-critical path). Call sites: `TenantGuard.autoProvisionMembership` (both the reactivate and create branches) and `tenant.service.ts` `acceptInvitation`/`acceptMyInvitation` (inside their `$transaction`, using `tx`).
- **Known gap** (documented, not fixed in B4): a brand-new CUSTOMER's `User` row is created by `ClerkJwtGuard.getOrCreateUser` with the schema default `userType: STAFF` — nothing calls `recomputeUserType` at that point (brief scoped the helper to exactly 2 call sites: invitation-accept + TenantGuard auto-provision). This is only a real gap on `@TenantOptional()` non-portal routes without `@AllowCustomer()`. B2/B3 (Clerk webhook `user.created` handling) is expected to set userType correctly for those.

## CustomerGuard (`libs/auth/src/guards/customer.guard.ts`)
- `PortalBuyer` interface and `BUYER_SELECT` now both include `userId`.
- Buyer resolution order, added in B4: (1) `Buyer.findFirst({ userId, tenant: { customerPortalEnabled: true } })` — reuses `request.user.id` already set by the global `ClerkJwtGuard` (guard order: global guards always run before local `@UseGuards` ones, so `request.user` is guaranteed present by the time `CustomerGuard` runs); (2) legacy `Buyer.findUnique({ clerkUserId })` fallback, with an opportunistic best-effort backfill of `userId` on that row; (3) existing link-by-email / auto-provision path, now also stamping `userId` when creating/linking. Legacy path kept "for one release" per the design doc — do not delete without checking B5's backfill script status.
- `mergeEmailDuplicates` in the same file is dead code (defined, never called) — pre-existing from the P0 hotfix, not touched by B4.
