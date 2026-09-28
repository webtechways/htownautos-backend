import { Controller, Post, Get } from '@nestjs/common';
import {
  AllowCustomer,
  TenantOptional,
  CurrentUser,
  ensureCustomerRoleMembership,
  PORTAL_TENANT_ID,
} from '@htownautos/auth';
import type { AuthenticatedUser } from '@htownautos/auth';
import { PrismaService } from '@htownautos/prisma';
import { RabbitMQService, CLERK_PUSH_QUEUE } from '@htownautos/rabbitmq';

/**
 * Auth bootstrap for the public stats app (stats.htownautos.com). Both
 * routes are reachable by a CUSTOMER-type user with NO membership yet (a
 * brand-new Clerk sign-up) — @AllowCustomer() + @TenantOptional() so
 * TenantGuard's STAFF_ONLY/tenant-resolution checks don't block the very
 * request that creates that membership. See identity/CLERK-SYNC-DESIGN.md
 * for the wider Clerk<->CRM sync this plugs into.
 */
@Controller()
export class StatsAuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitMQ: RabbitMQService,
  ) {}

  /**
   * Idempotent: ensures User + TenantUser(role "customer") + Buyer
   * (source "stats-signup") in the HtownAutos tenant for the caller's
   * already-verified Clerk identity, then recomputes userType. Safe to
   * call on every stats-app login, not just the first one.
   */
  @Post('stats/me/provision')
  @AllowCustomer()
  @TenantOptional()
  async provision(@CurrentUser() user: AuthenticatedUser) {
    const result = await ensureCustomerRoleMembership(this.prisma, {
      userId: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phoneNumber,
    });

    if (result.shouldPublish) {
      await this.rabbitMQ.publish(CLERK_PUSH_QUEUE, { userId: user.id }).catch(() => undefined);
    }

    return {
      provisioned: !!result.tenantUserId,
      buyerId: result.buyerId,
    };
  }

  /**
   * `{ role, permissions, userType }` for a frontend to decide what to show
   * in its menus. Role/permissions are resolved against the caller's active
   * membership in the HtownAutos portal tenant — today the only tenant the
   * "customer" role exists in. A staff caller (no HtownAutos membership)
   * gets `role: null, permissions: []`; this endpoint isn't meant for the
   * staff dashboard's own (tenant-scoped) permission model.
   */
  @Get('me/permissions')
  @AllowCustomer()
  @TenantOptional()
  async myPermissions(@CurrentUser() user: AuthenticatedUser) {
    const tenantUser = await this.prisma.tenantUser.findFirst({
      where: { userId: user.id, isActive: true, status: 'active', tenantId: PORTAL_TENANT_ID },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });

    return {
      role: tenantUser?.role.slug ?? null,
      permissions: tenantUser?.role.permissions.map((rp) => rp.permission.slug) ?? [],
      userType: user.userType,
    };
  }
}
