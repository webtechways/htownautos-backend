import { SetMetadata } from '@nestjs/common';

export const ALLOW_CUSTOMER_KEY = 'allowCustomer';

/**
 * Marks a route as reachable by CUSTOMER-type users. By default TenantGuard
 * rejects any authenticated user whose User.userType is CUSTOMER with a 403
 * `{ code: 'STAFF_ONLY' }` — this is the opt-in whitelist, not an opt-out.
 *
 * Use on:
 *  - PortalController routes (the customer portal itself).
 *  - `tenants/me/invitations*` routes (a customer accepting a staff
 *    invitation transitions to STAFF via recomputeUserType — they must be
 *    able to reach the route in the first place).
 *
 * Do NOT use on any route that reads/writes tenant-owned staff data — the
 * default-deny is the whole point.
 */
export const AllowCustomer = () => SetMetadata(ALLOW_CUSTOMER_KEY, true);
