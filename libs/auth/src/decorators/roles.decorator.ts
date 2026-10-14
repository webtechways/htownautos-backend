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
