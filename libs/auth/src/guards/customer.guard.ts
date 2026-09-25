import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { verifyToken, createClerkClient } from '@clerk/backend';
import { PrismaService } from '@htownautos/prisma';

// Instantiated directly (not via DI) so this guard stays self-contained and
// doesn't require wiring ClerkService into every module that provides
// CustomerGuard (e.g. PortalModule) — avoids the "Nest can't resolve
// dependencies" crash-loop from adding an unresolvable constructor param.
const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });

/**
 * Canonical tenant for htownautos.com public portal.
 * ALL portal customers belong to this tenant.
 */
export const PORTAL_TENANT_ID = '50197477-9e89-4465-bed5-99c638c435a0';

export interface PortalBuyer {
  id: string;
  tenantId: string;
  clerkUserId: string;
  userId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phoneMain: string;
  phoneMobile: string | null;
  phoneSecondary: string | null;
  currentAddress: string;
  currentCity: string;
  currentState: string;
  currentZipCode: string;
  currentCountry: string;
  stripeCustomerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const BUYER_SELECT = {
  id: true,
  tenantId: true,
  clerkUserId: true,
  userId: true,
  firstName: true,
  lastName: true,
  email: true,
  phoneMain: true,
  phoneMobile: true,
  phoneSecondary: true,
  currentAddress: true,
  currentCity: true,
  currentState: true,
  currentZipCode: true,
  currentCountry: true,
  stripeCustomerId: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * CustomerGuard — protects all portal endpoints.
 *
 * Distinct from ClerkJwtGuard + TenantGuard (staff path) by design:
 *
 *  1. Verifies the Clerk JWT independently (same `verifyToken` call).
 *  2. REJECTS tokens that carry an org_id claim — those are staff, not customers.
 *  3. Auto-provisions a Buyer row on first login (idempotent via clerkUserId).
 *  4. Attaches `request.buyer` (PortalBuyer) and `request.tenantId`.
 *
 * Usage: apply `@UseGuards(CustomerGuard)` (or `@CustomerAuth()`) on the
 * controller class or individual handlers.  Do NOT combine with the global
 * ClerkJwtGuard + TenantGuard chain — the portal routes use this guard ONLY.
 */
@Injectable()
export class CustomerGuard implements CanActivate {
  private readonly logger = new Logger(CustomerGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    let payload: any;
    try {
      payload = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY!,
      });
    } catch (err) {
      this.logger.warn(`CustomerGuard: token verification failed — ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Staff tokens carry an org_id.  Reject them on the customer portal.
    const orgId = payload.org_id || payload.o?.id;
    if (orgId) {
      throw new ForbiddenException(
        'Staff accounts cannot access the customer portal',
      );
    }

    const clerkUserId: string = payload.sub;
    const userMeta = this.extractUserMeta(request);

    // ClerkJwtGuard (global, runs before every local guard including this
    // one) already resolved/created the single-identity User row for this
    // token's `sub` and attached it to the request. Reuse it instead of a
    // second Clerk-independent lookup. Defensive null-check only — should
    // never be missing given the guard order, but this guard is written to
    // stay correct even if invoked standalone.
    const userId: string | null =
      request.user?.clerkUserId === clerkUserId ? request.user.id : null;

    const buyer = await this.getOrProvisionBuyer(clerkUserId, userMeta, userId);

    request.buyer = buyer;
    request.tenantId = buyer.tenantId;
    return true;
  }

  // ── private helpers ──────────────────────────────────────────────────────

  private extractToken(request: any): string | null {
    const auth: string | undefined = request.headers.authorization;
    if (auth?.startsWith('Bearer ')) return auth.substring(7);
    return null;
  }

  /**
   * X-Clerk-User header is a base64-encoded JSON blob sent by the Clerk
   * frontend SDK carrying first/last name, email, and image URL.
   * Used during auto-provisioning to seed the Buyer row.
   */
  private extractUserMeta(
    request: any,
  ): { email?: string; first_name?: string; last_name?: string } | null {
    try {
      const raw: string | undefined = request.headers['x-clerk-user'];
      if (!raw) return null;
      return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    } catch {
      return null;
    }
  }

  /**
   * Detect and merge duplicate Buyer rows in PORTAL_TENANT_ID that share the
   * same email (case-insensitive) as the authenticated buyer but have a
   * different id.
   *
   * Survivor selection:
   *   1. The buyer that has the most complete profile (non-empty currentAddress
   *      AND non-empty phoneMain — typical of a staff-created record).
   *   2. If tied, keep the oldest (smallest createdAt).
   *
   * Child rows re-pointed: VehicleInspection, BuyerFavorite, PortalOrder,
   * CustomerLedgerEntry. All done in a single transaction.
   *
   * Best-effort: any error is logged and the original buyer is returned — we
   * never break a login because of a failed merge.
   */
  private async mergeEmailDuplicates(
    authenticatedBuyer: PortalBuyer,
  ): Promise<PortalBuyer> {
    try {
      // Find all buyers in the portal tenant with the same email (excluding self).
      const duplicates = await this.prisma.buyer.findMany({
        where: {
          tenantId: PORTAL_TENANT_ID,
          id: { not: authenticatedBuyer.id },
          email: { equals: authenticatedBuyer.email, mode: 'insensitive' },
        },
        select: {
          id: true,
          currentAddress: true,
          phoneMain: true,
          clerkUserId: true,
          createdAt: true,
        },
      });

      if (duplicates.length === 0) return authenticatedBuyer;

      this.logger.log(
        `mergeEmailDuplicates: found ${duplicates.length} duplicate(s) for buyer ${authenticatedBuyer.id} (${authenticatedBuyer.email})`,
      );

      // Determine the survivor: all candidates including the authenticated buyer.
      const candidates = [
        {
          id: authenticatedBuyer.id,
          hasCompleteProfile:
            !!authenticatedBuyer.currentAddress && !!authenticatedBuyer.phoneMain,
          createdAt: authenticatedBuyer.createdAt,
          clerkUserId: authenticatedBuyer.clerkUserId,
        },
        ...duplicates.map((d) => ({
          id: d.id,
          hasCompleteProfile:
            !!d.currentAddress && d.currentAddress.length > 0 &&
            !!d.phoneMain && d.phoneMain.length > 0,
          createdAt: d.createdAt,
          clerkUserId: d.clerkUserId,
        })),
      ];

      // Sort: complete-profile first, then oldest first.
      candidates.sort((a, b) => {
        if (a.hasCompleteProfile !== b.hasCompleteProfile) {
          return a.hasCompleteProfile ? -1 : 1;
        }
        return a.createdAt.getTime() - b.createdAt.getTime();
      });

      const survivorId = candidates[0].id;
      const dupeIds = candidates.slice(1).map((c) => c.id);

      if (survivorId === authenticatedBuyer.id && dupeIds.length === 0) {
        return authenticatedBuyer;
      }

      this.logger.log(
        `mergeEmailDuplicates: survivor=${survivorId}, dupes=[${dupeIds.join(', ')}]`,
      );

      await this.prisma.$transaction(async (tx) => {
        // Ensure survivor has the clerkUserId (may be on a dupe row).
        const survivorHasClerk = candidates[0].clerkUserId != null;
        if (!survivorHasClerk) {
          // Find which candidate has the clerkUserId and set it on the survivor.
          const withClerk = candidates.find((c) => c.clerkUserId != null);
          if (withClerk) {
            await tx.buyer.update({
              where: { id: survivorId },
              data: { clerkUserId: withClerk.clerkUserId },
            });
          }
        }

        // Re-point child rows from each dupe to the survivor.
        for (const dupeId of dupeIds) {
          await tx.vehicleInspection.updateMany({
            where: { buyerId: dupeId },
            data: { buyerId: survivorId },
          });
          await tx.buyerFavorite.updateMany({
            where: { buyerId: dupeId },
            data: { buyerId: survivorId },
          });
          await tx.portalOrder.updateMany({
            where: { buyerId: dupeId },
            data: { buyerId: survivorId },
          });
          await tx.customerLedgerEntry.updateMany({
            where: { buyerId: dupeId },
            data: { buyerId: survivorId },
          });
        }

        // Delete duplicate rows — child FKs are all re-pointed or cascade-deleted.
        await tx.buyer.deleteMany({
          where: { id: { in: dupeIds }, tenantId: PORTAL_TENANT_ID },
        });
      });

      // Return the survivor's fresh data.
      const survivor = await this.prisma.buyer.findUnique({
        where: { id: survivorId },
        select: BUYER_SELECT,
      });
      if (!survivor) {
        this.logger.warn(
          `mergeEmailDuplicates: survivor ${survivorId} not found after merge — returning original`,
        );
        return authenticatedBuyer;
      }
      return survivor as PortalBuyer;
    } catch (err) {
      this.logger.error(
        `mergeEmailDuplicates: failed for buyer ${authenticatedBuyer.id} — ${(err as Error).message}`,
      );
      // Never break login because of a failed merge.
      return authenticatedBuyer;
    }
  }

  /**
   * Fetch the verified primary email for a Clerk user directly from Clerk —
   * the X-Clerk-User header is unsigned and client-controlled, so it is
   * NEVER used for lookup or linking, only as a display-field fallback for
   * brand-new signups (handled by the caller).
   */
  private async getVerifiedEmail(clerkUserId: string): Promise<string | null> {
    const user = await clerkClient.users.getUser(clerkUserId);
    const primary = user.emailAddresses.find(
      (e) => e.id === user.primaryEmailAddressId && e.verification?.status === 'verified',
    );
    return primary?.emailAddress ?? null;
  }

  /**
   * True only when Clerk confirms clerkUserId does NOT exist (404). Other
   * errors are rethrown so a transient Clerk outage never gets mistaken for
   * "this account is gone" and triggers an unwanted relink.
   */
  private async clerkUserIsGone(clerkUserId: string): Promise<boolean> {
    try {
      await clerkClient.users.getUser(clerkUserId);
      return false;
    } catch (error: any) {
      if (error?.status === 404) return true;
      throw error;
    }
  }

  /**
   * Find the Buyer by clerkUserId.  When none exists, auto-provision one in
   * the canonical portal tenant using Clerk's verified identity.  This is
   * idempotent: if two concurrent requests race, the second upsert is a no-op
   * (unique constraint on clerkUserId prevents duplicates).
   *
   * Resolution order (see CLERK-SYNC-DESIGN.md):
   *  1. User -> Buyer via `userId`, scoped to a tenant with
   *     `customerPortalEnabled` (the durable identity link).
   *  2. Legacy `buyers.clerkUserId` (kept as a fallback for one release while
   *     B5 backfills `userId` on existing rows).
   *  3. Link-by-email / auto-provision (unchanged), now also stamping
   *     `userId` on the Buyer so future logins hit path 1.
   */
  private async getOrProvisionBuyer(
    clerkUserId: string,
    meta: { email?: string; first_name?: string; last_name?: string } | null,
    userId: string | null,
  ): Promise<PortalBuyer> {
    // Preferred fast path: Buyer already linked via User.id.
    if (userId) {
      const linked = await this.prisma.buyer.findFirst({
        where: { userId, tenant: { customerPortalEnabled: true } },
        select: BUYER_SELECT,
      });
      if (linked) {
        return linked as PortalBuyer;
      }
    }

    // Legacy fast path: buyer already exists but not yet linked by userId —
    // no Clerk API call needed.
    const existing = await this.prisma.buyer.findUnique({
      where: { clerkUserId },
      select: BUYER_SELECT,
    });
    if (existing) {
      // Backfill the link opportunistically so the next login hits path 1.
      if (userId && !existing.userId) {
        try {
          await this.prisma.buyer.update({ where: { id: existing.id }, data: { userId } });
        } catch (err) {
          // Non-fatal — @@unique([tenantId, userId]) could theoretically
          // collide if this User is already linked to a different Buyer in
          // the same tenant. Never break login over a backfill link.
          this.logger.warn(
            `getOrProvisionBuyer: could not backfill userId on buyer ${existing.id} — ${(err as Error).message}`,
          );
        }
      }
      return existing as PortalBuyer;
    }

    // Slow path: first login — the JWT `sub` is unknown locally. Resolve the
    // verified email straight from Clerk (never from the unsigned header).
    const email = await this.getVerifiedEmail(clerkUserId);
    const firstName = meta?.first_name ?? '';
    const lastName = meta?.last_name ?? '';

    if (!email) {
      throw new UnauthorizedException(
        'No verified email associated with this Clerk account.',
      );
    }

    // Link path: a Buyer with this email already exists in the CRM (e.g. created
    // by staff) but isn't linked to a Clerk login yet. Adopt it instead of
    // creating a duplicate, so the website and the dashboard share ONE customer
    // record (favorites, inspections, deposits all land on the same buyer).
    // Only link when the row has no live clerkUserId of its own — otherwise
    // refuse (never silently steal an already-linked account).
    const byEmail = await this.prisma.buyer.findFirst({
      where: {
        tenantId: PORTAL_TENANT_ID,
        email: { equals: email, mode: 'insensitive' },
      },
      select: { id: true, clerkUserId: true },
    });
    if (byEmail) {
      const canLink = !byEmail.clerkUserId || (await this.clerkUserIsGone(byEmail.clerkUserId));
      if (!canLink) {
        this.logger.warn(
          `Refusing to link portal login ${clerkUserId} (${email}) — buyer ${byEmail.id} already linked to a different live Clerk account`,
        );
        throw new UnauthorizedException('Unable to authenticate this account');
      }

      this.logger.log(
        `Linking portal login to existing buyer ${byEmail.id} (${email})`,
      );
      const linked = await this.prisma.buyer.update({
        where: { id: byEmail.id },
        data: { clerkUserId, ...(userId ? { userId } : {}) },
        select: BUYER_SELECT,
      });
      return linked as PortalBuyer;
    }

    this.logger.log(
      `Auto-provisioning portal buyer: ${email} (Clerk: ${clerkUserId})`,
    );

    try {
      const created = await this.prisma.buyer.create({
        data: {
          clerkUserId,
          ...(userId ? { userId } : {}),
          tenantId: PORTAL_TENANT_ID,
          firstName: firstName || 'Portal',
          lastName: lastName || 'User',
          email,
          // Required non-nullable fields — portal customers fill them later.
          phoneMain: '',
          dateOfBirth: new Date('1900-01-01'),
          currentAddress: '',
          currentCity: '',
          currentState: '',
          currentZipCode: '',
          currentCountry: 'USA',
        },
        select: BUYER_SELECT,
      });
      return created as PortalBuyer;
    } catch (err: any) {
      // P2002 = unique constraint violation — concurrent request won the race.
      if (err?.code === 'P2002') {
        const retry = await this.prisma.buyer.findUnique({
          where: { clerkUserId },
          select: BUYER_SELECT,
        });
        if (retry) return retry as PortalBuyer;
      }
      throw err;
    }
  }
}
