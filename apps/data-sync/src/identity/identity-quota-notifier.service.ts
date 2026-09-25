import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import { PORTAL_TENANT_ID } from '@htownautos/auth';
import { ChatNotifierService } from '../chat-notifier.service';

/** Don't re-ping staff on every retry of the same still-unresolved 100-user cap. */
const QUOTA_NOTIFY_DEDUPE_MS = 60 * 60 * 1000;

const NOTIFICATION_TYPE = 'CLERK_QUOTA_EXCEEDED';

/**
 * Alerts portal-tenant staff once per hour while the Clerk dev instance's
 * 100-user cap is blocking identity pushes. See CLERK-SYNC-DESIGN.md — "stay
 * on the dev instance for now, surface `user_quota_exceeded` loudly".
 */
@Injectable()
export class IdentityQuotaNotifierService {
  private readonly logger = new Logger(IdentityQuotaNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatNotifierService,
  ) {}

  async notifyOnce(): Promise<void> {
    try {
      const recent = await this.prisma.notification.findFirst({
        where: { type: NOTIFICATION_TYPE, createdAt: { gt: new Date(Date.now() - QUOTA_NOTIFY_DEDUPE_MS) } },
        select: { id: true },
      });
      if (recent) return;

      const members = await this.prisma.tenantUser.findMany({
        where: { tenantId: PORTAL_TENANT_ID, isActive: true, status: 'active' },
        select: { tenantId: true, userId: true },
      });
      if (members.length === 0) return;

      const title = 'Límite de usuarios de Clerk alcanzado';
      const message =
        'La instancia de desarrollo de Clerk llegó a su límite de 100 usuarios — el portal de clientes no puede crear ni enlazar más cuentas hasta migrar a una instancia de producción.';

      await this.prisma.notification.createMany({
        data: members.map((m) => ({
          tenantId: m.tenantId,
          userId: m.userId,
          title,
          message,
          type: NOTIFICATION_TYPE,
          priority: 'high',
          actionUrl: '/dashboard/buyers',
        })),
        skipDuplicates: true,
      });

      await this.chat.send({
        tenantId: PORTAL_TENANT_ID,
        type: NOTIFICATION_TYPE,
        title,
        message,
        priority: 'high',
      });

      this.logger.warn('Clerk user_quota_exceeded — notified portal-tenant staff');
    } catch (err) {
      this.logger.warn(`notifyOnce: failed to notify quota exceeded — ${(err as Error).message}`);
    }
  }
}
