-- Public stats app (stats.htownautos.com) RBAC bootstrap.
-- See brief: enforce a real permission for the new `customer` role instead
-- of relying on userType alone. Adds:
--   1. Permission "auction-stats:read" (resource "auction-stats", action
--      "read") -- gates seeing unmasked finalBid/price data on the public
--      auction-sale-results stats endpoints.
--   2. Global role "customer" (tenantId NULL, same scoping convention as the
--      other system roles seeded by rbac.seed.ts -- see Role.@@unique([
--      tenantId, slug]) and TenantGuard.autoProvisionMembership's fallback
--      lookup) with ONLY that permission attached.
-- Both rows stay editable through the existing Roles/Permissions UI+API
-- (RolesController / roles.service.ts) -- this migration only seeds the
-- starting state, same as rbac.seed.ts does for the staff roles.
--
-- Idempotent: INSERT ... ON CONFLICT DO NOTHING throughout. No DROP.
-- Rollback: DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM
-- roles WHERE slug = 'customer' AND "tenantId" IS NULL); DELETE FROM roles
-- WHERE slug = 'customer' AND "tenantId" IS NULL; DELETE FROM permissions
-- WHERE slug = 'auction-stats:read'; (only safe if no TenantUser row
-- references the role -- none should, right after this ships).

-- pgcrypto provides gen_random_uuid(); no-op if already enabled.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Permission: auction-stats:read
INSERT INTO "permissions" ("id", "action", "resource", "slug", "description", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'read', 'auction-stats', 'auction-stats:read',
       'View auction sale price data (stats.htownautos.com)', now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "slug" = 'auction-stats:read');

-- Role: customer (global, tenantId NULL -- same convention as admin/salesperson/etc.)
INSERT INTO "roles" ("id", "name", "slug", "description", "isSystem", "tenantId", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'Customer', 'customer',
       'Public stats portal customer (read-only)', true, NULL, true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "roles" WHERE "slug" = 'customer' AND "tenantId" IS NULL);

-- RolePermission: customer role -> auction-stats:read (only permission it has)
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r, "permissions" p
WHERE r."slug" = 'customer' AND r."tenantId" IS NULL
  AND p."slug" = 'auction-stats:read'
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id"
  );
