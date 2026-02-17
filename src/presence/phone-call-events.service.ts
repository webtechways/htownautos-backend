import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';

export interface PhoneCallEventUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
}

export interface PhoneCallEventCaller {
  id: string;
  user: PhoneCallEventUser;
}

export interface PhoneCallEventBuyer {
  id: string;
  firstName: string;
  lastName: string;
  phoneMain: string | null;
}

export interface PhoneCallEventTransferUser {
  id: string;
  user: PhoneCallEventUser;
}

export interface PhoneCallEvent {
  id: string;
  tenantId: string;
  direction: 'inbound' | 'outbound';
  status: string;
  outcome?: string | null;
  fromNumber: string;
  toNumber: string;
  startedAt: string;
  answeredAt?: string | null;
  endedAt?: string | null;
  duration?: number | null;
  buyerId?: string | null;
  callerId?: string | null;
  recordingUrl?: string | null;
  transcription?: string | null;
  transcriptionStatus?: string | null;
  // Related data for display
  caller?: PhoneCallEventCaller | null;
  buyer?: PhoneCallEventBuyer | null;
  // Transfer data
  transferredAt?: string | null;
  transferReason?: string | null;
  transferredTo?: PhoneCallEventTransferUser | null;
  transferredFrom?: PhoneCallEventTransferUser | null;
}

/**
 * Service for emitting phone call events via WebSocket.
 * This service is used by PhoneCallService to notify clients of call changes in real-time.
 */
@Injectable()
export class PhoneCallEventsService {
  private readonly logger = new Logger(PhoneCallEventsService.name);
  private server: Server | null = null;

  /**
   * Set the Socket.IO server instance.
   * Called by PresenceGateway after initialization.
   */
  setServer(server: Server) {
    this.server = server;
    this.logger.log('Socket.IO server set for phone call events');
  }

  /**
   * Emit a phone call created event to the tenant room.
   */
  emitCallCreated(call: PhoneCallEvent) {
    if (!this.server) {
      this.logger.warn('Cannot emit call_created: Socket server not initialized');
      return;
    }

    const room = `tenant:${call.tenantId}`;
    this.server.to(room).emit('call_created', {
      call,
      timestamp: new Date().toISOString(),
    });

    this.logger.log(`Emitted call_created to ${room} for call ${call.id}`);
  }

  /**
   * Emit a phone call updated event to the tenant room.
   */
  emitCallUpdated(call: PhoneCallEvent) {
    if (!this.server) {
      this.logger.warn('Cannot emit call_updated: Socket server not initialized');
      return;
    }

    const room = `tenant:${call.tenantId}`;
    this.server.to(room).emit('call_updated', {
      call,
      timestamp: new Date().toISOString(),
    });

    this.logger.log(`Emitted call_updated to ${room} for call ${call.id} (status: ${call.status})`);
  }

  /**
   * Emit a phone call completed event to the tenant room.
   * This is a convenience method for when a call ends.
   */
  emitCallCompleted(call: PhoneCallEvent) {
    if (!this.server) {
      this.logger.warn('Cannot emit call_completed: Socket server not initialized');
      return;
    }

    const room = `tenant:${call.tenantId}`;
    this.server.to(room).emit('call_completed', {
      call,
      timestamp: new Date().toISOString(),
    });

    this.logger.log(`Emitted call_completed to ${room} for call ${call.id}`);
  }
}
