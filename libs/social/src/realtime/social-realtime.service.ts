import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import { RabbitMQService } from '@htownautos/rabbitmq';
import { SOCIAL_REALTIME_QUEUE, type SocialRealtimeQueueMessage } from '../queues';
import type { SocialRealtimeEventName } from '../types';

/**
 * Emits Social Suite realtime events to `tenant:<id>` Socket.IO rooms.
 *
 * Same two-mode pattern as `apps/api/src/presence/sms-events.service.ts`:
 *  - api: the presence gateway calls `setServer(this.server)` once from its
 *    `afterInit()` (see PresenceGateway), after which `emit()` pushes
 *    straight into the room — no round trip through RabbitMQ.
 *  - data-sync: no Socket.IO server lives in this process, so `setServer` is
 *    never called and `emit()` instead publishes to `SOCIAL_REALTIME_QUEUE`.
 *    The api registers its own consumer for that queue (wired in
 *    `apps/api/src/social/social.module.ts`, which owns both this service's
 *    provider and the PresenceGateway) that re-emits into the room, so a
 *    browser client never needs to know which process produced the event.
 */
@Injectable()
export class SocialRealtimeService {
  private readonly logger = new Logger(SocialRealtimeService.name);
  private server: Server | null = null;

  constructor(private readonly rabbitMQ: RabbitMQService) {}

  /** Called once by the process that owns the Socket.IO server (api only). */
  setServer(server: Server) {
    this.server = server;
  }

  /** True once `setServer` has been called — lets the api-side bridge avoid double-consuming. */
  hasLocalServer(): boolean {
    return this.server !== null;
  }

  async emit(tenantId: string, event: SocialRealtimeEventName, payload: unknown): Promise<void> {
    if (this.server) {
      this.server.to(`tenant:${tenantId}`).emit(event, payload);
      return;
    }

    try {
      const msg: SocialRealtimeQueueMessage = { tenantId, event, payload };
      const ok = await this.rabbitMQ.publish(SOCIAL_REALTIME_QUEUE, msg);
      if (!ok) {
        this.logger.warn(`emit ${event} tenant=${tenantId}: RabbitMQ no disponible`);
      }
    } catch (err) {
      this.logger.warn(`emit ${event} tenant=${tenantId}: ${(err as Error).message}`);
    }
  }

  /** Re-emits a message that arrived from `SOCIAL_REALTIME_QUEUE` into the local Socket.IO room. */
  emitLocal(tenantId: string, event: string, payload: unknown): void {
    if (!this.server) return;
    this.server.to(`tenant:${tenantId}`).emit(event, payload);
  }
}
