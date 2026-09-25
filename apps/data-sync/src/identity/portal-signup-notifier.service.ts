import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import { PORTAL_TENANT_ID } from '@htownautos/auth';
import { ChatNotifierService } from '../chat-notifier.service';

const NOTIFICATION_TYPE = 'PORTAL_SIGNUP';

/**
 * One-shot staff notification when a web sign-up (Clerk `user.created` with
 * `unsafe_metadata.signupSource === 'web'`) creates a CRM lead. Called at
 * most once per Buyer — `ClerkEventsConsumer.createWebSignupBuyer` only
 * creates the Buyer (and calls this) the first time it sees that User, and
 * webhook idempotency (`ClerkWebhookEvent.processedAt`) covers redeliveries.
 * See docs/identity/CLERK-SYNC-DESIGN.md (package B3).
 */
@Injectable()
export class PortalSignupNotifierService {
  private readonly logger = new Logger(PortalSignupNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatNotifierService,
  ) {}

  async notify(buyerId: string, displayName: string): Promise<void> {
    try {
      const members = await this.prisma.tenantUser.findMany({
        where: { tenantId: PORTAL_TENANT_ID, isActive: true, status: 'active' },
        select: { tenantId: true, userId: true },
      });
      if (members.length === 0) return;

      const title = 'Nuevo registro en el portal';
      const message = `${displayName} se registró desde el portal web (htownautos.com) — falta completar su perfil.`;
      const actionUrl = `/dashboard/buyers/${buyerId}`;

      await this.prisma.notification.createMany({
        data: members.map((m) => ({
          tenantId: m.tenantId,
          userId: m.userId,
          title,
          message,
          type: NOTIFICATION_TYPE,
          priority: 'normal',
          entityType: 'Buyer',
          entityId: buyerId,
          actionUrl,
        })),
        skipDuplicates: true,
      });

      await this.chat.send({
        tenantId: PORTAL_TENANT_ID,
        type: NOTIFICATION_TYPE,
        title,
        message,
        priority: 'normal',
        actionUrl,
      });
    } catch (err) {
      this.logger.warn(`notify: failed for buyer ${buyerId} — ${(err as Error).message}`);
    }
  }
}
