import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Decorator to require specific roles for an endpoint
 * @param roles - Array of role slugs that are allowed (e.g., ['owner', 'admin', 'manager'])
 */
export const RequireRoles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

// Common role groups for convenience
export const ADMIN_ROLES = ['owner', 'admin', 'manager'];
export const OWNER_ONLY = ['owner'];

export const ALLOW_API_KEY_KEY = 'allowApiKey';

/**
 * Opt-in for `@RequireRoles` routes: lets a scoped API key call this route
 * acting as the tenant's admin, WITHOUT a TenantUser row. Safe only because:
 *  - `ApiKeyGuard` already enforces the route's `@RequireApiScopes` write
 *    scope (403 if missing) before `RolesGuard` even runs;
 *  - `ApiKeyGuard` already pins `request.tenant` to the key's own tenant —
 *    there's no cross-tenant path.
 * The human/Clerk JWT path (TenantUser + role lookup) is unchanged. Add this
 * ONLY to routes that are meant to be reachable by a tenant's own
 * server-to-server integration (e.g. PrecioTope), never blanket-enable it.
 */
export const AllowApiKey = () => SetMetadata(ALLOW_API_KEY_KEY, true);
