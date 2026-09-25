import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '@htownautos/prisma';
import { resolveTenantUserIdentity } from '@htownautos/common';
import { ALLOW_CUSTOMER_KEY } from '../decorators/allow-customer.decorator';
import { recomputeUserType } from '../recompute-user-type';

// Decorator key for marking routes that don't require tenant
export const TENANT_OPTIONAL_KEY = 'tenantOptional';

// Custom error code for frontend to detect tenant issues
export const TENANT_ERROR_CODE = 'TENANT_REQUIRED';

@Injectable()
export class TenantGuard implements CanActivate {
  private readonly logger = new Logger(TenantGuard.name);

  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // If no user (not authenticated — e.g. @Public() route), let ClerkJwtGuard
    // handle it. Must come before the STAFF_ONLY check since there is no
    // userType to check yet.
    if (!user) {
      return true;
    }

    // Default-deny: CUSTOMER users may only reach routes explicitly marked
    // @AllowCustomer() (the portal + invitation-acceptance routes). This runs
    // BEFORE the tenantOptional early return below — tenantOptional alone
    // (e.g. `tenants/my-tenants`, `tenants/check-slug/:slug`) must NOT be
    // enough to let a customer identity through.
    if (user.userType === 'CUSTOMER') {
      const allowCustomer = this.reflector.getAllAndOverride<boolean>(ALLOW_CUSTOMER_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowCustomer) {
        throw new ForbiddenException({
          message: 'This account is a customer login and cannot access staff routes.',
          error: 'Forbidden',
          statusCode: 403,
          code: 'STAFF_ONLY',
        });
      }
    }

    // Check if tenant is optional for this route
    const isTenantOptional = this.reflector.getAllAndOverride<boolean>(
      TENANT_OPTIONAL_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (isTenantOptional) {
      return true;
    }

    // ApiKeyGuard already resolved tenant + user — skip membership check.
    if (request.apiKey && request.tenant) {
      return true;
    }

    // Resolve tenant: prefer JWT org_id (Clerk Organizations), fall back to X-Tenant-Id header (legacy)
    const clerkOrgId = request.clerkOrgId; // Set by ClerkJwtGuard from JWT
    const legacyTenantId = request.headers['x-tenant-id'];

    let tenant: any = null;

    if (clerkOrgId) {
      // New path: resolve tenant by Clerk Organization ID from JWT
      tenant = await this.prisma.$queryRawUnsafe(
        `SELECT * FROM tenants WHERE clerk_org_id = $1 LIMIT 1`,
        clerkOrgId,
      ).then((rows: any[]) => rows[0] || null);
    } else if (legacyTenantId) {
      // Legacy path: resolve tenant by UUID from X-Tenant-Id header
      tenant = await this.prisma.tenant.findUnique({
        where: { id: legacyTenantId },
      });
    }

    if (!tenant) {
      throw new ForbiddenException({
        message: 'Tenant ID is required. Please select a business.',
        error: 'Forbidden',
        statusCode: 403,
        code: TENANT_ERROR_CODE,
      });
    }

    if (!tenant.isActive) {
      throw new ForbiddenException({
        message: 'This business is currently inactive.',
        error: 'Forbidden',
        statusCode: 403,
        code: TENANT_ERROR_CODE,
      });
    }

    // Verify user has access to this tenant
    let tenantUser = await this.prisma.tenantUser.findUnique({
      where: {
        tenantId_userId: { tenantId: tenant.id, userId: user.id },
      },
    });

    // Auto-provision: Clerk says the user is a member of this org (JWT contains
    // the org_id) but no TenantUser row exists yet — the webhook may have been
    // missed or the user was invited before they had a local User record.
    if ((!tenantUser || !tenantUser.isActive) && clerkOrgId) {
      tenantUser = await this.autoProvisionMembership(tenant.id, user.id, request.clerkOrgRole);
    }

    if (!tenantUser || !tenantUser.isActive || tenantUser.status !== 'active') {
      throw new ForbiddenException({
        message: 'You do not have access to this business.',
        error: 'Forbidden',
        statusCode: 403,
        code: TENANT_ERROR_CODE,
      });
    }

    // Attach tenant to request for use in controllers and other guards
    request.tenant = tenant;
    request.tenantUser = tenantUser;

    return true;
  }

  /**
   * If Clerk's JWT says the user belongs to this org but we have no TenantUser
   * row, create one on the fly. This covers:
   *  - Webhook missed (dev without tunnel, network blip, etc.)
   *  - User accepted invitation before their local User record existed.
   *  - Race condition between webhook and first authenticated request.
   */
  private async autoProvisionMembership(
    tenantId: string,
    userId: string,
    clerkOrgRole?: string,
  ) {
    try {
      const roleSlug = clerkOrgRole === 'org:admin' ? 'owner' : 'salesperson';

      // Try tenant-scoped role first, then global fallback.
      const role =
        (await this.prisma.role.findFirst({ where: { slug: roleSlug, tenantId } })) ||
        (await this.prisma.role.findFirst({ where: { slug: roleSlug, tenantId: null } }));

      if (!role) {
        this.logger.warn(
          `Auto-provision skipped: role "${roleSlug}" not found for tenant ${tenantId}`,
        );
        return null;
      }

      // Check if an inactive/removed row exists — reactivate it.
      const existing = await this.prisma.tenantUser.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
      });

      // Look up tenant subdomain + user contact info once, for identity resolution.
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { subdomain: true },
      });
      const userRow = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, firstName: true, lastName: true },
      });

      if (existing) {
        // Backfill missing username/tenantEmail for legacy rows created before this migration.
        const patchIdentity =
          !existing.username || !existing.tenantEmail
            ? await resolveTenantUserIdentity(
                this.prisma,
                tenantId,
                userRow || {},
                tenant?.subdomain,
                existing.id,
              )
            : null;

        const updated = await this.prisma.tenantUser.update({
          where: { id: existing.id },
          data: {
            status: 'active',
            isActive: true,
            roleId: role.id,
            acceptedAt: new Date(),
            ...(patchIdentity
              ? {
                  username: existing.username || patchIdentity.username,
                  tenantEmail: existing.tenantEmail || patchIdentity.tenantEmail,
                }
              : {}),
          },
        });
        this.logger.log(`Auto-reactivated TenantUser ${userId} in tenant ${tenantId}`);
        await recomputeUserType(this.prisma, userId);
        return updated;
      }

      const identity = await resolveTenantUserIdentity(
        this.prisma,
        tenantId,
        userRow || {},
        tenant?.subdomain,
      );

      const created = await this.prisma.tenantUser.create({
        data: {
          tenantId,
          userId,
          roleId: role.id,
          status: 'active',
          isActive: true,
          acceptedAt: new Date(),
          username: identity.username,
          tenantEmail: identity.tenantEmail,
        },
      });
      this.logger.log(
        `Auto-provisioned TenantUser ${userId} in tenant ${tenantId} as ${roleSlug} (${identity.tenantEmail || identity.username})`,
      );
      await recomputeUserType(this.prisma, userId);
      return created;
    } catch (err: any) {
      this.logger.error(`Auto-provision failed for user ${userId} tenant ${tenantId}: ${err.message}`);
      return null;
    }
  }
}
