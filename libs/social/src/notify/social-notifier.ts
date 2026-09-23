import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import { RabbitMQService, CHAT_DISPATCH_QUEUE, type ChatDispatchMessage } from '@htownautos/rabbitmq';

export interface SocialNotifyInput {
  title: string;
  message: string;
  actionUrl?: string | null;
  entityId?: string | null;
}

/**
 * Fans a Social Suite notification out to every active staff member of the
 * tenant (dashboard bell) and the tenant's connected chat channels
 * (Telegram/Discord/Slack), in one call usable from either app.
 *
 * Reimplements the two existing patterns directly against
 * PrismaService/RabbitMQService — rather than depending on api's
 * `NotificationsService` or data-sync's `ChatNotifierService` — because
 * those live in their respective apps, not in a shared lib. Rule carried
 * over from both: one notification per logical event, not per row/recipient.
 *
 * Best-effort: never throws. A notification failure must never break the
 * publish/webhook/job path that triggered it.
 */
@Injectable()
export class SocialNotifierService {
  private readonly logger = new Logger(SocialNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitMQ: RabbitMQService,
  ) {}

  async notify(tenantId: string, type: string, input: SocialNotifyInput): Promise<void> {
    try {
      const staff = await this.prisma.tenantUser.findMany({
        where: { tenantId, status: 'active', isActive: true },
        select: { userId: true },
      });

      if (staff.length > 0) {
        const userIds = Array.from(new Set(staff.map((s) => s.userId)));
        await this.prisma.notification.createMany({
          data: userIds.map((userId) => ({
            tenantId,
            userId,
            title: input.title,
            message: input.message,
            type,
            entityType: 'social',
            entityId: input.entityId ?? null,
            actionUrl: input.actionUrl ?? null,
            priority: 'normal',
          })),
          skipDuplicates: true,
        });
      }

      const chat: ChatDispatchMessage = {
        tenantId,
        type,
        title: input.title,
        message: input.message,
        priority: 'normal',
        actionUrl: input.actionUrl ?? null,
      };
      await this.rabbitMQ.publish(CHAT_DISPATCH_QUEUE, chat);
    } catch (err) {
      this.logger.warn(`notify: tenant=${tenantId} type=${type} — ${(err as Error).message}`);
    }
  }
}
