import { Injectable } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import { ADMIN_ROLES, type AuthenticatedUser } from '@htownautos/auth';
import type { SocialSettings } from '@prisma/client';

/**
 * Shared read helpers for the Social Suite's tenant-level config. Exported
 * from SettingsModule so other packages (e.g. B2b's approval flow on
 * `POST /social/posts`) can check `isAdmin`/read settings without duplicating
 * the role lookup.
 */
@Injectable()
export class SocialAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Whether `user` holds an admin-tier role (owner/admin/manager) in `tenantId`. */
  async isAdmin(user: Pick<AuthenticatedUser, 'id'> | null | undefined, tenantId: string): Promise<boolean> {
    if (!user?.id || !tenantId) return false;
    const tenantUser = await this.prisma.tenantUser.findUnique({
      where: { tenantId_userId: { tenantId, userId: user.id } },
      include: { role: { select: { slug: true } } },
    });
    if (!tenantUser || !tenantUser.isActive) return false;
    return ADMIN_ROLES.includes(tenantUser.role.slug);
  }

  /** Lazily creates the tenant's SocialSettings row (all-defaults) on first read. */
  async getSettings(tenantId: string): Promise<SocialSettings> {
    return this.prisma.socialSettings.upsert({
      where: { tenantId },
      create: { tenantId },
      update: {},
    });
  }
}
