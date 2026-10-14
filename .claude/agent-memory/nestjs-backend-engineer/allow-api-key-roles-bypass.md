---
name: allow-api-key-roles-bypass
description: How to safely let a scoped API key call an otherwise @RequireRoles(ADMIN_ROLES) admin-only route (PrecioTope social T2)
metadata:
  type: project
---

For PrecioTope-as-a-tenant (PT social suite, 2026-10-14): PT's server-to-server
API key needs to call a handful of routes that are normally staff-only via
`@UseGuards(RolesGuard) @RequireRoles(...ADMIN_ROLES)` — `social/posts/:id/approve|reject`,
`social-accounts/connect/whatsapp/manual`, `inbox/twilio/sync-webhooks`,
`PATCH social/settings`.

**Pattern used**: added an explicit opt-in decorator `@AllowApiKey()`
(`libs/auth/src/decorators/roles.decorator.ts`, exported from the lib index) that
`RolesGuard` checks via Reflector *before* doing the TenantUser/role lookup. If
`request.apiKey` is set (by `ApiKeyGuard`) and the route has `@AllowApiKey()`, it
passes — no TenantUser row needed. If `request.apiKey` is set and the route does
NOT have the decorator, it 403s immediately (same outcome as before, just
short-circuited before the useless DB lookup).

**Why this is safe to do on the *global* `RolesGuard`** (touching a global guard
is normally the kind of change that DI-crash-loops the API — see
[[global-guard-di-crashloop]]): `RolesGuard` already takes `Reflector` +
`PrismaService`, I added zero new constructor params, only a new metadata key
read via the existing `reflector.getAllAndOverride`. `ApiKeyGuard` runs earlier
in the global chain and already (a) enforces the route's `@RequireApiScopes`
write scope, 403 if missing, and (b) pins `request.tenant` to the key's own
tenant — so `@AllowApiKey()` never needs to re-check scope or tenant itself,
it only needs to exist on routes meant to be reachable this way. Every other
`@RequireRoles` consumer (`tenant.controller`, `api-keys.controller`,
`bid-increments.controller`, `portal-settings.controller`) is unaffected because
none of them added the decorator.

**Verification trick for "no DI crash-loop" without a reachable dev DB**: `npx
nx serve api` booting far enough to hit a *Prisma* connection error on an
unrelated service (`ProxySyncService.onModuleInit`) is good evidence — it means
Nest finished constructing the whole module graph (all guards included) before
ever talking to Postgres. A guard/decorator DI mistake fails earlier, during
module construction, not at a runtime DB call.
