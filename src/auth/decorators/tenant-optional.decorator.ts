import { SetMetadata } from '@nestjs/common';
import { TENANT_OPTIONAL_KEY } from '../guards/tenant.guard';

/**
 * Decorator to mark a route as not requiring a tenant
 * Use this for routes like:
 * - GET /tenants/my-tenants (user needs to see their tenants before selecting one)
 * - POST /tenants (user needs to create a tenant)
 * - Invitation acceptance routes
 */
export const TenantOptional = () => SetMetadata(TENANT_OPTIONAL_KEY, true);
