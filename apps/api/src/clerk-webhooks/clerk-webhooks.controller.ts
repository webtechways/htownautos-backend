import {
  Controller,
  Post,
  Req,
  Logger,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { verifyWebhook } from '@clerk/backend/webhooks';
import { Public } from '@htownautos/auth';
import { PrismaService } from '@htownautos/prisma';
import { resolveTenantUserIdentity } from '@htownautos/common';

/**
 * Handles Clerk webhook events for syncing organization memberships.
 *
 * Clerk sends these events when org memberships change (via Dashboard or API).
 * We sync them to our TenantUser table to keep local data consistent.
 *
 * Every request is verified via svix (Standard Webhooks) signature before
 * processing. main.ts registers this route for raw-body parsing so the
 * exact bytes are available for signature verification.
 */
@Controller('clerk-webhooks')
export class ClerkWebhooksController {
  private readonly logger = new Logger(ClerkWebhooksController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Req() req: any) {
    const signingSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    if (!signingSecret) {
      this.logger.error('CLERK_WEBHOOK_SIGNING_SECRET is not configured');
      throw new BadRequestException('Webhook not configured');
    }

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers ?? {})) {
      if (Array.isArray(value)) headers.set(key, value.join(', '));
      else if (typeof value === 'string') headers.set(key, value);
    }

    const request = new Request('https://clerk-webhooks.internal/api/v1/clerk-webhooks', {
      method: 'POST',
      headers,
      body: req.body as unknown as BodyInit,
    });

    let event: any;
    try {
      event = await verifyWebhook(request, { signingSecret });
    } catch (error) {
      this.logger.warn(`Clerk webhook signature verification failed: ${(error as Error).message}`);
      throw new BadRequestException('Invalid webhook signature');
    }

    const eventType = event?.type;

    this.logger.log(`Received Clerk webhook: ${eventType}`);

    try {
      switch (eventType) {
        case 'organizationMembership.created':
          await this.handleMembershipCreated(event.data);
          break;
        case 'organizationMembership.updated':
          await this.handleMembershipUpdated(event.data);
          break;
        case 'organizationMembership.deleted':
          await this.handleMembershipDeleted(event.data);
          break;
        case 'organization.created':
          await this.handleOrganizationCreated(event.data);
          break;
        case 'organization.deleted':
          await this.handleOrganizationDeleted(event.data);
          break;
        default:
          this.logger.debug(`Unhandled webhook event: ${eventType}`);
      }
    } catch (error) {
      this.logger.error(`Webhook processing failed for ${eventType}:`, error);
    }

    return { received: true };
  }

  private async handleMembershipCreated(data: any) {
    const clerkOrgId = data.organization?.id;
    const clerkUserId = data.public_user_data?.user_id;
    const role = data.role; // e.g., 'org:admin', 'org:member'

    if (!clerkOrgId || !clerkUserId) return;

    // Find tenant by clerk org ID
    const tenants: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT id FROM tenants WHERE clerk_org_id = $1 LIMIT 1`,
      clerkOrgId,
    );
    if (tenants.length === 0) return;
    const tenantId = tenants[0].id;

    // Find user by clerk user ID
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });
    if (!user) {
      this.logger.warn(`User not found for Clerk ID ${clerkUserId}`);
      return;
    }

    // Find the appropriate role in our DB
    const roleSlug = role === 'org:admin' ? 'owner' : 'salesperson';
    const dbRole = await this.prisma.role.findFirst({
      where: { slug: roleSlug, tenantId },
    });

    if (!dbRole) {
      this.logger.warn(`Role ${roleSlug} not found for tenant ${tenantId}`);
      return;
    }

    // Upsert TenantUser
    const existing = await this.prisma.tenantUser.findUnique({
      where: { tenantId_userId: { tenantId, userId: user.id } },
    });

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { subdomain: true },
    });

    if (existing) {
      // Backfill username/tenantEmail for legacy rows created before identity resolution
      const patch =
        !existing.username || !existing.tenantEmail
          ? await resolveTenantUserIdentity(
              this.prisma,
              tenantId,
              { email: user.email, firstName: user.firstName, lastName: user.lastName },
              tenant?.subdomain,
              existing.id,
            )
          : null;

      await this.prisma.tenantUser.update({
        where: { id: existing.id },
        data: {
          status: 'active',
          isActive: true,
          roleId: dbRole.id,
          acceptedAt: new Date(),
          ...(patch
            ? {
                username: existing.username || patch.username,
                tenantEmail: existing.tenantEmail || patch.tenantEmail,
              }
            : {}),
        },
      });
      this.logger.log(`Reactivated membership: ${user.email} in tenant ${tenantId}`);
    } else {
      const identity = await resolveTenantUserIdentity(
        this.prisma,
        tenantId,
        { email: user.email, firstName: user.firstName, lastName: user.lastName },
        tenant?.subdomain,
      );

      await this.prisma.tenantUser.create({
        data: {
          tenantId,
          userId: user.id,
          roleId: dbRole.id,
          status: 'active',
          isActive: true,
          acceptedAt: new Date(),
          username: identity.username,
          tenantEmail: identity.tenantEmail,
        },
      });
      this.logger.log(
        `Created membership: ${user.email} in tenant ${tenantId} as ${identity.tenantEmail || identity.username}`,
      );
    }
  }

  private async handleMembershipUpdated(data: any) {
    const clerkOrgId = data.organization?.id;
    const clerkUserId = data.public_user_data?.user_id;
    const role = data.role;

    if (!clerkOrgId || !clerkUserId) return;

    const tenants: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT id FROM tenants WHERE clerk_org_id = $1 LIMIT 1`,
      clerkOrgId,
    );
    if (tenants.length === 0) return;
    const tenantId = tenants[0].id;

    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });
    if (!user) return;

    const roleSlug = role === 'org:admin' ? 'owner' : 'salesperson';
    const dbRole = await this.prisma.role.findFirst({
      where: { slug: roleSlug, tenantId },
    });
    if (!dbRole) return;

    await this.prisma.tenantUser.updateMany({
      where: { tenantId, userId: user.id },
      data: { roleId: dbRole.id },
    });

    this.logger.log(`Updated role for ${user.email} to ${roleSlug} in tenant ${tenantId}`);
  }

  private async handleMembershipDeleted(data: any) {
    const clerkOrgId = data.organization?.id;
    const clerkUserId = data.public_user_data?.user_id;

    if (!clerkOrgId || !clerkUserId) return;

    const tenants: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT id FROM tenants WHERE clerk_org_id = $1 LIMIT 1`,
      clerkOrgId,
    );
    if (tenants.length === 0) return;
    const tenantId = tenants[0].id;

    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });
    if (!user) return;

    await this.prisma.tenantUser.updateMany({
      where: { tenantId, userId: user.id },
      data: { status: 'removed', isActive: false },
    });

    this.logger.log(`Removed membership: ${user.email} from tenant ${tenantId}`);
  }

  private async handleOrganizationCreated(data: any) {
    const clerkOrgId = data.id;
    const name = data.name;
    const slug = data.slug || data.id;
    const createdBy = data.created_by; // Clerk user ID of the creator
    const meta = data.public_metadata || {};

    // Check if tenant already exists for this org (created via app's POST /tenants)
    const existing: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT id FROM tenants WHERE clerk_org_id = $1 LIMIT 1`,
      clerkOrgId,
    );
    if (existing.length > 0) {
      this.logger.log(`Tenant already exists for Clerk org ${clerkOrgId}, skipping`);
      return;
    }

    // Create a new tenant linked to this Clerk org (safety net for orgs created outside the app)
    const tenantRows: any[] = await this.prisma.$queryRawUnsafe(
      `INSERT INTO tenants (id, name, slug, clerk_org_id, "businessName", "isActive", "createdAt", "updatedAt", country)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, true, now(), now(), 'USA')
       RETURNING id`,
      name,
      slug,
      clerkOrgId,
      meta.businessName || name,
    );

    const tenantId = tenantRows[0]?.id;
    this.logger.log(`Created tenant ${tenantId} for Clerk org: ${name} (${clerkOrgId})`);

    // Link the creator as owner if we can find them
    if (createdBy && tenantId) {
      const creator = await this.prisma.user.findUnique({
        where: { clerkUserId: createdBy },
      });

      if (creator) {
        // Get or find owner role (global)
        const ownerRole = await this.prisma.role.findFirst({
          where: { slug: 'owner', tenantId: null },
        });

        if (ownerRole) {
          // Load the tenant we just inserted to see if it has a subdomain
          const tenantRow = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { subdomain: true },
          });
          const identity = await resolveTenantUserIdentity(
            this.prisma,
            tenantId,
            { email: creator.email, firstName: creator.firstName, lastName: creator.lastName },
            tenantRow?.subdomain,
          );

          await this.prisma.tenantUser.create({
            data: {
              tenantId,
              userId: creator.id,
              roleId: ownerRole.id,
              status: 'active',
              isActive: true,
              acceptedAt: new Date(),
              username: identity.username,
              tenantEmail: identity.tenantEmail,
            },
          });
          this.logger.log(
            `Linked creator ${creator.email} as owner of tenant ${tenantId} (${identity.tenantEmail || identity.username})`,
          );
        }
      }
    }

    // Update Clerk org metadata with the DB tenant ID
    // so the frontend can map the org to the correct tenant
    try {
      const { createClerkClient } = require('@clerk/backend');
      const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
      await clerk.organizations.updateOrganization(clerkOrgId, {
        publicMetadata: {
          ...meta,
          tenantId,
          slug,
          businessName: meta.businessName || name,
        },
      });
      this.logger.log(`Updated Clerk org ${clerkOrgId} metadata with tenantId ${tenantId}`);
    } catch (error) {
      this.logger.error(`Failed to update Clerk org metadata:`, error);
    }
  }

  private async handleOrganizationDeleted(data: any) {
    const clerkOrgId = data.id;

    await this.prisma.$queryRawUnsafe(
      `UPDATE tenants SET "isActive" = false, "deletedAt" = now() WHERE clerk_org_id = $1`,
      clerkOrgId,
    );

    this.logger.log(`Deactivated tenant for deleted Clerk org: ${clerkOrgId}`);
  }
}
