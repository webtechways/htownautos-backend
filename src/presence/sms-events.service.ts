import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';

export interface SmsEventUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
}

export interface SmsEventSender {
  id: string;
  user: SmsEventUser;
}

export interface SmsEventBuyer {
  id: string;
  firstName: string;
  lastName: string;
  phoneMain: string | null;
  phoneMobile: string | null;
}

export interface SmsEvent {
  id: string;
  tenantId: string;
  direction: 'inbound' | 'outbound';
  status: string;
  fromNumber: string;
  toNumber: string;
  body: string;
  messageSid?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  mediaUrls?: string[] | null;
  numMedia?: number;
  isRead: boolean;
  buyerId: string;
  senderId?: string | null;
  sentAt?: string | null;
  deliveredAt?: string | null;
  createdAt: string;
  // Related data
  sender?: SmsEventSender | null;
  buyer?: SmsEventBuyer | null;
}

/**
 * Service for emitting SMS events via WebSocket.
 * Used for real-time updates to SMS conversations.
 */
@Injectable()
export class SmsEventsService {
  private readonly logger = new Logger(SmsEventsService.name);
  private server: Server | null = null;

  /**
   * Set the Socket.IO server instance.
   * Called by PresenceGateway after initialization.
   */
  setServer(server: Server) {
    this.server = server;
    this.logger.log('Socket.IO server set for SMS events');
  }

  /**
   * Emit a new SMS message event to the tenant room.
   */
  emitSmsCreated(sms: SmsEvent) {
    if (!this.server) {
      this.logger.warn('Cannot emit sms_created: Socket server not initialized');
      return;
    }

    const room = `tenant:${sms.tenantId}`;
    this.server.to(room).emit('sms_created', {
      sms,
      timestamp: new Date().toISOString(),
    });

    this.logger.log(`Emitted sms_created to ${room} for message ${sms.id}`);
  }

  /**
   * Emit an SMS status update event to the tenant room.
   */
  emitSmsUpdated(sms: SmsEvent) {
    if (!this.server) {
      this.logger.warn('Cannot emit sms_updated: Socket server not initialized');
      return;
    }

    const room = `tenant:${sms.tenantId}`;
    this.server.to(room).emit('sms_updated', {
      sms,
      timestamp: new Date().toISOString(),
    });

    this.logger.log(`Emitted sms_updated to ${room} for message ${sms.id} (status: ${sms.status})`);
  }
}
