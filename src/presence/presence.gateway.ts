import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { PresenceService } from './presence.service';
import { PhoneCallEventsService } from './phone-call-events.service';
import { SmsEventsService } from './sms-events.service';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

interface AuthenticatedSocket extends Socket {
  cognitoSub?: string; // Cognito sub from JWT
  dbUserId?: string; // Real database user ID
  tenantId?: string;
}

@WebSocketGateway({
  namespace: '/presence',
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3001'],
    credentials: true,
  },
})
export class PresenceGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(PresenceGateway.name);
  private verifier: ReturnType<typeof CognitoJwtVerifier.create>;
  private socketUserMap = new Map<string, { userId: string; tenantId: string }>();

  constructor(
    private readonly presenceService: PresenceService,
    private readonly phoneCallEventsService: PhoneCallEventsService,
    private readonly smsEventsService: SmsEventsService,
  ) {
    this.verifier = CognitoJwtVerifier.create({
      userPoolId: process.env.COGNITO_USER_POOL_ID!,
      tokenUse: 'access',
      clientId: process.env.COGNITO_CLIENT_ID!,
    });
  }

  afterInit() {
    this.logger.log('Presence WebSocket Gateway initialized');
    // Share the Socket.IO server with event services
    this.phoneCallEventsService.setServer(this.server);
    this.smsEventsService.setServer(this.server);
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token = client.handshake.auth?.token;

      if (!token) {
        this.logger.warn(`Client ${client.id} connected without token`);
        client.emit('error', { message: 'Authentication required' });
        client.disconnect();
        return;
      }

      const payload = await this.verifier.verify(token);
      client.cognitoSub = payload.sub;

      // Get the real database user ID
      const dbUserId = await this.presenceService.getUserIdFromCognitoSub(payload.sub);
      if (!dbUserId) {
        this.logger.warn(`User with cognitoSub ${payload.sub} not found in database`);
        client.emit('error', { message: 'User not found' });
        client.disconnect();
        return;
      }
      client.dbUserId = dbUserId;

      this.logger.log(`Client ${client.id} authenticated as user ${client.dbUserId}`);

      // Notify client that authentication is complete
      client.emit('authenticated', { userId: dbUserId });
    } catch (error) {
      this.logger.error(`Auth failed for client ${client.id}: ${error.message}`);
      client.emit('error', { message: 'Authentication failed' });
      client.disconnect();
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    const mapping = this.socketUserMap.get(client.id);

    if (mapping) {
      const { userId, tenantId } = mapping;

      // Pass cognitoSub to setUserOffline
      if (client.cognitoSub) {
        await this.presenceService.setUserOffline(client.cognitoSub, tenantId);
      }

      // Notify others in the tenant with the database user ID
      this.server.to(`tenant:${tenantId}`).emit('user_offline', {
        userId,
        timestamp: new Date().toISOString(),
      });

      this.socketUserMap.delete(client.id);
      this.logger.log(`User ${userId} disconnected from tenant ${tenantId}`);
    }
  }

  @SubscribeMessage('join_tenant')
  async handleJoinTenant(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { tenantId: string },
  ) {
    const { tenantId } = data;

    if (!client.cognitoSub || !client.dbUserId) {
      client.emit('error', { message: 'Not authenticated' });
      return { success: false };
    }

    // Join the tenant room
    client.join(`tenant:${tenantId}`);
    client.tenantId = tenantId;

    // Store mapping for cleanup (use database user ID)
    this.socketUserMap.set(client.id, { userId: client.dbUserId, tenantId });

    // Mark user as online (pass cognitoSub)
    await this.presenceService.setUserOnline(client.cognitoSub, tenantId);

    // Notify ALL clients in the tenant room (including sender)
    const room = `tenant:${tenantId}`;
    const socketsInRoom = await this.server.in(room).fetchSockets();
    this.logger.log(`Broadcasting user_online to ${socketsInRoom.length} sockets in room ${room}`);

    this.server.to(room).emit('user_online', {
      userId: client.dbUserId,
      timestamp: new Date().toISOString(),
    });

    // Send current online users to the joining client
    const onlineUsers = await this.presenceService.getOnlineUsers(tenantId);
    client.emit('presence_sync', { users: onlineUsers });

    this.logger.log(`User ${client.dbUserId} joined tenant ${tenantId}`);
    return { success: true };
  }

  @SubscribeMessage('leave_tenant')
  async handleLeaveTenant(@ConnectedSocket() client: AuthenticatedSocket) {
    if (!client.tenantId || !client.cognitoSub || !client.dbUserId) {
      return { success: false };
    }

    const { tenantId, dbUserId, cognitoSub } = client;

    client.leave(`tenant:${tenantId}`);
    await this.presenceService.setUserOffline(cognitoSub, tenantId);

    this.server.to(`tenant:${tenantId}`).emit('user_offline', {
      userId: dbUserId,
      timestamp: new Date().toISOString(),
    });

    this.socketUserMap.delete(client.id);
    client.tenantId = undefined;

    this.logger.log(`User ${dbUserId} left tenant ${tenantId}`);
    return { success: true };
  }

  @SubscribeMessage('heartbeat')
  async handleHeartbeat(@ConnectedSocket() client: AuthenticatedSocket) {
    if (!client.dbUserId || !client.tenantId) {
      return { success: false };
    }

    // updateActivity uses database user ID directly
    await this.presenceService.updateActivity(client.dbUserId, client.tenantId);
    return { success: true, timestamp: new Date().toISOString() };
  }
}
