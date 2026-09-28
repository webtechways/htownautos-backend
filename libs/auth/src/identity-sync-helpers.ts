import { Logger } from '@nestjs/common';
import type { PrismaService } from '@htownautos/prisma';
import { normalizePhoneNumber } from '@htownautos/common';
import { PORTAL_TENANT_ID } from './guards/customer.guard';
import { recomputeUserType } from './recompute-user-type';

const logger = new Logger('identitySyncHelpers');

/**
 * Best-effort CRM -> Clerk identity linking, called from buyer create/update
 * (`buyers.service.ts`) and portal profile edits (`portal.service.ts`).
 * See docs/identity/CLERK-SYNC-DESIGN.md (package B2).
 *
 * Never throws — a Clerk-identity glitch must not block the staff or
 * customer workflow that triggered it. Callers only need `userId` +
 * `shouldPublish` to decide whether to enqueue `identity.clerk.push`.
 */
export interface EnsureUserForBuyerInput {
  buyerId: string;
  tenantId: string;
  email: string | null | undefined;
  phoneMain?: string | null;
  firstName: string;
  lastName: string;
}

export interface EnsureUserForBuyerResult {
  userId: string | null;
  shouldPublish: boolean;
}

export async function ensureUserForBuyer(
  prisma: PrismaService,
  input: EnsureUserForBuyerInput,
): Promise<EnsureUserForBuyerResult> {
  try {
    const email = input.email?.trim().toLowerCase() || null;
    const phone = normalizePhoneNumber(input.phoneMain ?? null);

    const buyer = await prisma.buyer.findUnique({
      where: { id: input.buyerId },
      select: { userId: true },
    });
    if (!buyer) return { userId: null, shouldPublish: false };

    // No identifier to link/create a User with. Buyer.email is a required
    // column so this is a defensive branch (legacy/blank rows), not the
    // common case — see CLERK-SYNC-DESIGN.md "Buyer without email".
    if (!email) {
      if (buyer.userId) {
        await prisma.user
          .update({
            where: { id: buyer.userId },
            data: { clerkSyncStatus: 'SKIPPED', clerkSyncError: 'no_email' },
          })
          .catch(() => undefined);
      }
      return { userId: buyer.userId, shouldPublish: false };
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: { customerPortalEnabled: true },
    });
    const portalEnabled = !!tenant?.customerPortalEnabled;

    let userId = buyer.userId;
    if (!userId) {
      // Match order per design: normalised email first, then E.164 phone.
      const byEmail = await prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { id: true },
      });
      userId = byEmail?.id ?? null;

      if (!userId && phone) {
        const byPhone = await prisma.user.findFirst({
          where: { phoneNumber: phone },
          select: { id: true },
        });
        userId = byPhone?.id ?? null;
      }

      if (!userId) {
        // Brand-new identity — schema defaults userType to STAFF, so it must
        // be set explicitly here. An existing match (email/phone) keeps
        // whatever userType it already has (never downgrade a STAFF user who
        // happens to also be a buyer).
        const created = await prisma.user.create({
          data: {
            email,
            firstName: input.firstName || null,
            lastName: input.lastName || null,
            name: [input.firstName, input.lastName].filter(Boolean).join(' ') || email,
            phoneNumber: phone ?? undefined,
            userType: 'CUSTOMER',
            clerkSyncStatus: portalEnabled ? 'PENDING' : 'SKIPPED',
          },
          select: { id: true },
        });
        userId = created.id;
      }

      try {
        await prisma.buyer.update({ where: { id: input.buyerId }, data: { userId } });
      } catch (err) {
        // @@unique([tenantId, userId]) could theoretically collide on a race
        // (two buyers in the same tenant resolving to the same User
        // concurrently) — vanishingly rare, and never worth failing the
        // buyer write over.
        logger.warn(
          `ensureUserForBuyer: could not link buyer ${input.buyerId} to user ${userId} — ${(err as Error).message}`,
        );
      }
    } else {
      // Already linked — refresh the contact fields a CRM edit is allowed to
      // own. Deliberately NOT touching User.email here: it's the Clerk
      // login identity (verified), and changing it is a separate,
      // permission+audit-gated action (design decision 4), not implicit in
      // "staff edited the buyer's contact email".
      await prisma.user
        .update({
          where: { id: userId },
          data: {
            firstName: input.firstName || undefined,
            lastName: input.lastName || undefined,
            phoneNumber: phone ?? undefined,
          },
        })
        .catch((err) => {
          logger.warn(`ensureUserForBuyer: could not refresh user ${userId} — ${(err as Error).message}`);
        });
    }

    await prisma.user
      .update({
        where: { id: userId as string },
        data: portalEnabled
          ? { clerkSyncStatus: 'PENDING', clerkSyncAttempts: 0, clerkSyncError: null }
          : { clerkSyncStatus: 'SKIPPED' },
      })
      .catch((err) => {
        logger.warn(`ensureUserForBuyer: could not set clerkSyncStatus for user ${userId} — ${(err as Error).message}`);
      });

    return { userId: userId as string, shouldPublish: portalEnabled };
  } catch (err) {
    logger.warn(`ensureUserForBuyer: failed for buyer ${input.buyerId} — ${(err as Error).message}`);
    return { userId: null, shouldPublish: false };
  }
}

/**
 * Called right after a Buyer row is deleted (buyer create/update's sibling —
 * `buyers.service.ts` remove/removeBulk). Only re-triggers a push when the
 * buyer belonged to a portal-enabled tenant, since a non-portal buyer's User
 * was never pushed to Clerk in the first place (see CLERK-SYNC-DESIGN.md).
 *
 * Does NOT decide whether to ban — the data-sync consumer (B3) recomputes
 * that fresh from the DB (does this User still have any portal Buyer left?)
 * every time it processes a push, so it stays correct even if this message
 * races with a re-create of the same buyer.
 */
export interface EnsureCustomerRoleMembershipInput {
  userId: string;
  firstName?: string | null;
  lastName?: string | null;
  email: string;
  phone?: string | null;
}

export interface EnsureCustomerRoleMembershipResult {
  buyerId: string | null;
  tenantUserId: string | null;
  shouldPublish: boolean;
}

/**
 * Public stats app (stats.htownautos.com) provisioning: ensures a Buyer +
 * TenantUser(role "customer") pair in the canonical HtownAutos portal
 * tenant for an already-authenticated Clerk user, then recomputes
 * userType. Called from both `POST /stats/me/provision` (apps/api) and the
 * Clerk webhook consumer's `unsafe_metadata.signupSource === 'stats'`
 * branch (apps/data-sync) — same "lead stub, staff completes it later"
 * pattern as `createWebSignupBuyer`'s web-signup Buyer, but this one ALSO
 * gets a TenantUser row so PermissionsGuard/TenantGuard's customer-role
 * permission check (auction-stats:read) has something to look up.
 *
 * Idempotent, best-effort — never throws (auth-critical path).
 */
export async function ensureCustomerRoleMembership(
  prisma: PrismaService,
  input: EnsureCustomerRoleMembershipInput,
): Promise<EnsureCustomerRoleMembershipResult> {
  try {
    let buyer = await prisma.buyer.findFirst({
      where: { userId: input.userId, tenantId: PORTAL_TENANT_ID },
      select: { id: true },
    });

    if (!buyer) {
      // Required columns we have no real value for yet (DOB/address) get an
      // explicit placeholder, mirroring createWebSignupBuyer — this is a
      // lead stub, not a finished KYC record. phoneMain has a
      // @@unique([tenantId, phoneMain]); fall back to a per-user placeholder
      // instead of '' to avoid colliding on a second no-phone signup.
      buyer = await prisma.buyer.create({
        data: {
          tenantId: PORTAL_TENANT_ID,
          userId: input.userId,
          firstName: input.firstName || 'Cliente',
          lastName: input.lastName || 'Stats',
          email: input.email,
          phoneMain: input.phone ?? `pending-${input.userId}`,
          dateOfBirth: new Date('1900-01-01'),
          currentAddress: '',
          currentCity: '',
          currentState: '',
          currentZipCode: '',
          source: 'stats-signup',
          notes: 'Lead creado automáticamente por sign-up en stats.htownautos.com — perfil incompleto.',
          metaValue: { incompleteProfile: true },
        },
        select: { id: true },
      });
    }

    const customerRole = await prisma.role.findFirst({
      where: { slug: 'customer', tenantId: null },
      select: { id: true },
    });

    let tenantUserId: string | null = null;
    if (customerRole) {
      const existingTenantUser = await prisma.tenantUser.findUnique({
        where: { tenantId_userId: { tenantId: PORTAL_TENANT_ID, userId: input.userId } },
      });
      if (existingTenantUser) {
        tenantUserId = existingTenantUser.id;
        if (!existingTenantUser.isActive || existingTenantUser.status !== 'active') {
          await prisma.tenantUser.update({
            where: { id: existingTenantUser.id },
            data: { isActive: true, status: 'active', acceptedAt: existingTenantUser.acceptedAt ?? new Date() },
          });
        }
      } else {
        const created = await prisma.tenantUser.create({
          data: {
            tenantId: PORTAL_TENANT_ID,
            userId: input.userId,
            roleId: customerRole.id,
            isActive: true,
            status: 'active',
            acceptedAt: new Date(),
          },
          select: { id: true },
        });
        tenantUserId = created.id;
      }
    } else {
      logger.warn('ensureCustomerRoleMembership: "customer" role not found — run the RBAC migration/seed');
    }

    const { shouldPublish } = await ensureUserForBuyer(prisma, {
      buyerId: buyer.id,
      tenantId: PORTAL_TENANT_ID,
      email: input.email,
      phoneMain: input.phone,
      firstName: input.firstName || 'Cliente',
      lastName: input.lastName || 'Stats',
    });

    await recomputeUserType(prisma, input.userId);

    return { buyerId: buyer.id, tenantUserId, shouldPublish };
  } catch (err) {
    logger.warn(`ensureCustomerRoleMembership: failed for user ${input.userId} — ${(err as Error).message}`);
    return { buyerId: null, tenantUserId: null, shouldPublish: false };
  }
}

export async function syncUserOnBuyerRemoved(
  prisma: PrismaService,
  params: { userId: string; tenantId: string },
): Promise<{ shouldPublish: boolean }> {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: params.tenantId },
      select: { customerPortalEnabled: true },
    });
    if (!tenant?.customerPortalEnabled) return { shouldPublish: false };

    await prisma.user.update({
      where: { id: params.userId },
      data: { clerkSyncStatus: 'PENDING', clerkSyncAttempts: 0, clerkSyncError: null },
    });
    return { shouldPublish: true };
  } catch (err) {
    logger.warn(
      `syncUserOnBuyerRemoved: failed for user ${params.userId} — ${(err as Error).message}`,
    );
    return { shouldPublish: false };
  }
}
