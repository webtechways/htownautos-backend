import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * CurrentTenant decorator
 * Extracts the current tenant ID from the X-Tenant-ID header
 * or returns the first tenant from the user's tenants array
 */
export const CurrentTenant = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();

    // First check for X-Tenant-ID header
    const headerTenantId = request.headers['x-tenant-id'];
    if (headerTenantId) {
      return headerTenantId;
    }

    // Fallback to first tenant from user's tenants array
    const user = request.user;
    if (user?.tenants?.length > 0) {
      return user.tenants[0].tenantId;
    }

    return null;
  },
);
