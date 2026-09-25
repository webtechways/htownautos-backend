// Module
export { AuthModule } from './auth.module';

// Services
export { AuthService } from './auth.service';
export { ClerkService } from './clerk.service';

// Guards
export { ApiKeyGuard } from './guards/api-key.guard';
export { ClerkJwtGuard } from './guards/clerk-jwt.guard';
export type { ClerkTokenPayload, AuthenticatedUser } from './guards/clerk-jwt.guard';
export { TenantGuard, TENANT_OPTIONAL_KEY, TENANT_ERROR_CODE } from './guards/tenant.guard';
export { RolesGuard } from './guards/roles.guard';
export { PermissionsGuard } from './guards/permissions.guard';
export { CustomerGuard, PORTAL_TENANT_ID } from './guards/customer.guard';
export type { PortalBuyer } from './guards/customer.guard';

// Identity helpers
export { recomputeUserType } from './recompute-user-type';

// Decorators
export { Public, IS_PUBLIC_KEY } from './decorators/public.decorator';
export { CurrentUser } from './decorators/current-user.decorator';
export { CurrentTenant } from './decorators/current-tenant.decorator';
export { TenantOptional } from './decorators/tenant-optional.decorator';
export { CurrentBuyer } from './decorators/current-buyer.decorator';
export { CustomerAuth } from './decorators/customer-auth.decorator';
export { AllowCustomer, ALLOW_CUSTOMER_KEY } from './decorators/allow-customer.decorator';
export { RequireRoles, ROLES_KEY, ADMIN_ROLES, OWNER_ONLY } from './decorators/roles.decorator';
export { RequirePermissions, PERMISSIONS_KEY } from './decorators/permissions.decorator';
export { RequireApiScopes, API_SCOPES_KEY } from './decorators/api-scopes.decorator';

// Constants
export {
  API_SCOPE_RESOURCES,
  API_SCOPE_ACTIONS,
  ALL_API_SCOPES,
  hasScope,
  validateScopes,
} from './constants/api-scopes';
export type { ApiScopeAction, ApiScopeResource } from './constants/api-scopes';
