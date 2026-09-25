import { Logger } from '@nestjs/common';
import type { PrismaService } from '@htownautos/prisma';
import { normalizePhoneNumber } from '@htownautos/common';

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
