import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Decorator to extract the current tenant ID from the request headers
 * 
 * @example
 * @Get('vehicles')
 * getVehicles(@CurrentTenant() tenantId: string) {
 *   return this.vehiclesService.findAll(tenantId);
 * }
 */
export const CurrentTenant = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string | null => {
    const request = ctx.switchToHttp().getRequest();
    return request.headers['x-tenant-id'] || null;
  },
);
