import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import {
  RabbitMQService,
  CHAT_DISPATCH_QUEUE,
  type ChatDispatchMessage,
} from '@htownautos/rabbitmq';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { ListNotificationsDto } from './dto/list-notifications.dto';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitMQ: RabbitMQService,
  ) {}

  // ── Create (single) ──────────────────────────────────────────────────────────

  async create(
    tenantId: string,
    userId: string,
    data: CreateNotificationDto,
  ) {
    return this.prisma.notification.create({
      data: {
        tenantId,
        userId,
        title: data.title,
        message: data.message,
        type: data.type,
        entityType: data.entityType ?? null,
        entityId: data.entityId ?? null,
        actionUrl: data.actionUrl ?? null,
        priority: data.priority ?? 'normal',
        metaValue: data.metaValue != null
          ? (data.metaValue as Prisma.InputJsonValue)
          : undefined,
      },
    });
  }

  // ── Fan-out to all active tenant staff ───────────────────────────────────────

  /**
   * Creates one Notification row per active staff member of the tenant.
   * Best-effort: any error is swallowed and logged — a notification failure
   * must NEVER propagate up to break the customer action that triggered it.
   */
  async notifyTenantStaff(
    tenantId: string,
    data: CreateNotificationDto,
  ): Promise<void> {
    try {
      const staff = await this.prisma.tenantUser.findMany({
        where: { tenantId, status: 'active', isActive: true },
        select: { userId: true },
      });

      if (staff.length === 0) return;

      // Deduplicate userIds (should not happen, but guard against it).
      const userIds = Array.from(new Set(staff.map((s) => s.userId)));

      const metaValue = data.metaValue != null
        ? (data.metaValue as Prisma.InputJsonValue)
        : undefined;

      await this.prisma.notification.createMany({
        data: userIds.map((userId) => ({
          tenantId,
          userId,
          title: data.title,
          message: data.message,
          type: data.type,
          entityType: data.entityType ?? null,
          entityId: data.entityId ?? null,
          actionUrl: data.actionUrl ?? null,
          priority: data.priority ?? 'normal',
          metaValue,
        })),
        skipDuplicates: true,
      });

      // Y fuera del dashboard: a los canales de chat que el tenant tenga
      // conectados. Va por cola —el reparto lo hace data-sync— para no meter
      // peticiones HTTP salientes en el camino que atiende al cliente.
      const chat: ChatDispatchMessage = {
        tenantId,
        type: data.type,
        title: data.title,
        message: data.message,
        priority: data.priority ?? 'normal',
        actionUrl: data.actionUrl ?? null,
      };
      // `publish` devuelve false si RabbitMQ esta caido; no lanza.
      await this.rabbitMQ.publish(CHAT_DISPATCH_QUEUE, chat);
    } catch (err) {
      this.logger.warn(
        `notifyTenantStaff: tenant=${tenantId} type=${data.type} — ${(err as Error).message}`,
      );
      // Never throw — caller must not be affected.
    }
  }

  // ── List (paginated) ─────────────────────────────────────────────────────────

  async list(
    userId: string,
    tenantId: string,
    query: ListNotificationsDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    // `status` supersedes the legacy `unreadOnly` flag when both are present.
    const status =
      query.status ?? (query.unreadOnly ? 'unread' : 'all');

    const search = query.search;

    const where: Prisma.NotificationWhereInput = {
      userId,
      tenantId,
      ...(status === 'unread' ? { isRead: false } : {}),
      ...(status === 'read' ? { isRead: true } : {}),
      ...(query.types?.length ? { type: { in: query.types } } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' as const } },
              { message: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  // ── Unread count ─────────────────────────────────────────────────────────────

  async unreadCount(userId: string, tenantId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, tenantId, isRead: false },
    });
  }

  // ── Per-type facets ──────────────────────────────────────────────────────────

  /**
   * Powers the notification-center type filter: every type this user actually
   * has, with its total and unread counts. Derived from the data rather than a
   * hardcoded list, so a new producer shows up in the UI without a frontend
   * change.
   */
  async stats(userId: string, tenantId: string) {
    const [byType, byTypeUnread] = await Promise.all([
      this.prisma.notification.groupBy({
        by: ['type'],
        where: { userId, tenantId },
        _count: { _all: true },
      }),
      this.prisma.notification.groupBy({
        by: ['type'],
        where: { userId, tenantId, isRead: false },
        _count: { _all: true },
      }),
    ]);

    const unreadByType = new Map(
      byTypeUnread.map((r) => [r.type, r._count._all]),
    );

    const types = byType
      .map((r) => ({
        type: r.type,
        count: r._count._all,
        unread: unreadByType.get(r.type) ?? 0,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      total: types.reduce((sum, t) => sum + t.count, 0),
      unread: types.reduce((sum, t) => sum + t.unread, 0),
      types,
    };
  }

  // ── Mark single read ─────────────────────────────────────────────────────────

  async markRead(id: string, userId: string) {
    // where: id + userId — cross-user read is silently a no-op (updateMany returns
    // count 0), which is safe; a missing notification is not an error on a read path.
    await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true, readAt: new Date() },
    });
    return { ok: true };
  }

  // ── Mark all read ────────────────────────────────────────────────────────────

  async markAllRead(userId: string, tenantId: string) {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, tenantId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { ok: true, updated: count };
  }
}
