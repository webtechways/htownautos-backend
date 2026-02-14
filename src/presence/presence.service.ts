import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma.service';

export interface UserPresence {
  userId: string;
  isOnline: boolean;
  lastSeenAt?: string;
}

// User is considered online if active within the last 2 minutes
const ONLINE_THRESHOLD_MS = 2 * 60 * 1000;

@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Mark user as online (WebSocket connection)
   * @param cognitoSub - The Cognito sub (user ID from JWT)
   * @param tenantId - The tenant ID
   */
  async setUserOnline(cognitoSub: string, tenantId: string): Promise<void> {
    // Find the actual user by cognitoSub
    const user = await this.prisma.user.findUnique({
      where: { cognitoSub },
      select: { id: true },
    });

    if (!user) {
      this.logger.warn(`User with cognitoSub ${cognitoSub} not found`);
      return;
    }

    const userId = user.id;
    const key = `presence:${tenantId}:${userId}`;
    const now = Date.now();

    // Set in Redis with 5 minute expiry (refreshed by heartbeat)
    await this.redis.getClient().setex(key, 300, now.toString());
    await this.redis.getClient().sadd(`presence:tenant:${tenantId}`, userId);

    // Update database
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        isOnline: true,
        lastActivityAt: new Date(),
      },
    });

    this.logger.log(`User ${userId} is now online in tenant ${tenantId}`);
  }

  /**
   * Update user's last activity (called on every API request or heartbeat)
   */
  async updateActivity(userId: string, tenantId: string): Promise<void> {
    const key = `presence:${tenantId}:${userId}`;
    const now = Date.now();

    // Set in Redis with 5 minute expiry
    await this.redis.getClient().setex(key, 300, now.toString());

    // Add to tenant's active users set
    await this.redis.getClient().sadd(`presence:tenant:${tenantId}`, userId);
  }

  /**
   * Check if a user is online (active within threshold)
   */
  async isUserOnline(userId: string, tenantId: string): Promise<boolean> {
    const key = `presence:${tenantId}:${userId}`;
    const lastActivity = await this.redis.getClient().get(key);

    if (!lastActivity) {
      return false;
    }

    const lastActivityTime = parseInt(lastActivity, 10);
    const isOnline = Date.now() - lastActivityTime < ONLINE_THRESHOLD_MS;

    return isOnline;
  }

  /**
   * Get all online users for a tenant
   */
  async getOnlineUsers(tenantId: string): Promise<UserPresence[]> {
    const userIds = await this.redis.getClient().smembers(`presence:tenant:${tenantId}`);

    if (userIds.length === 0) {
      return [];
    }

    const presencePromises = userIds.map(async (userId) => {
      const isOnline = await this.isUserOnline(userId, tenantId);
      const key = `presence:${tenantId}:${userId}`;
      const lastActivity = await this.redis.getClient().get(key);

      return {
        userId,
        isOnline,
        lastSeenAt: lastActivity ? new Date(parseInt(lastActivity, 10)).toISOString() : undefined,
      };
    });

    const results = await Promise.all(presencePromises);
    return results.filter(r => r.isOnline);
  }

  /**
   * Get presence status for all users in a tenant
   */
  async getTenantUsersPresence(tenantId: string): Promise<UserPresence[]> {
    // Get all users for this tenant from database
    const tenantUsers = await this.prisma.tenantUser.findMany({
      where: {
        tenantId,
        isActive: true,
        status: 'active',
      },
      select: {
        userId: true,
        user: {
          select: {
            id: true,
            lastSeenAt: true,
          },
        },
      },
    });

    // Check Redis for real-time online status
    const presencePromises = tenantUsers.map(async (tu) => {
      const isOnline = await this.isUserOnline(tu.userId, tenantId);
      const key = `presence:${tenantId}:${tu.userId}`;
      const lastActivity = await this.redis.getClient().get(key);

      return {
        userId: tu.userId,
        isOnline,
        lastSeenAt: lastActivity
          ? new Date(parseInt(lastActivity, 10)).toISOString()
          : tu.user.lastSeenAt?.toISOString(),
      };
    });

    return Promise.all(presencePromises);
  }

  /**
   * Mark user as offline (when they log out or disconnect)
   * @param cognitoSub - The Cognito sub (user ID from JWT)
   * @param tenantId - The tenant ID
   */
  async setUserOffline(cognitoSub: string, tenantId: string): Promise<void> {
    // Find the actual user by cognitoSub
    const user = await this.prisma.user.findUnique({
      where: { cognitoSub },
      select: { id: true },
    });

    if (!user) {
      this.logger.warn(`User with cognitoSub ${cognitoSub} not found`);
      return;
    }

    const userId = user.id;
    const key = `presence:${tenantId}:${userId}`;
    await this.redis.getClient().del(key);
    await this.redis.getClient().srem(`presence:tenant:${tenantId}`, userId);

    // Update database
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        isOnline: false,
        lastSeenAt: new Date(),
      },
    });

    this.logger.log(`User ${userId} is now offline in tenant ${tenantId}`);
  }

  /**
   * Get the real user ID from Cognito sub
   */
  async getUserIdFromCognitoSub(cognitoSub: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { cognitoSub },
      select: { id: true },
    });
    return user?.id || null;
  }
}
