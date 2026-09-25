import { Logger } from '@nestjs/common';
import type { UserType } from '@prisma/client';

const logger = new Logger('recomputeUserType');

/**
 * Minimal shape this helper needs — satisfied by both PrismaService and a
 * Prisma.TransactionClient, so it can run inside an existing transaction
 * (e.g. invitation acceptance) or standalone (e.g. TenantGuard auto-provision).
 */
interface UserTypeRecomputeClient {
  tenantUser: {
    count: (args: { where: Record<string, unknown> }) => Promise<number>;
  };
  user: {
    update: (args: { where: { id: string }; data: { userType: UserType } }) => Promise<unknown>;
  };
}

/**
 * Recompute User.userType from ground truth: STAFF iff the user has at least
 * one active TenantUser membership, CUSTOMER otherwise. Call this whenever
 * membership changes — invitation acceptance, TenantGuard auto-provisioning.
 * Never trust a User's current userType as an input to this decision.
 *
 * Best-effort: logs and returns null on failure rather than throwing, since
 * every call site is inside an auth-critical path where we don't want a
 * userType recompute glitch to block login or invitation acceptance.
 */
export async function recomputeUserType(
  prisma: UserTypeRecomputeClient,
  userId: string,
): Promise<UserType | null> {
  try {
    const activeMemberships = await prisma.tenantUser.count({
      where: { userId, isActive: true, status: 'active' },
    });
    const userType = (activeMemberships > 0 ? 'STAFF' : 'CUSTOMER') as UserType;
    await prisma.user.update({ where: { id: userId }, data: { userType } });
    return userType;
  } catch (err) {
    logger.error(`Failed to recompute userType for user ${userId}: ${(err as Error).message}`);
    return null;
  }
}
