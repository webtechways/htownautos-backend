import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { INestApplication, Logger } from '@nestjs/common';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter>;
  private readonly logger = new Logger(RedisIoAdapter.name);

  constructor(app: INestApplication) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
    };

    const pubClient = new Redis(redisConfig);
    const subClient = new Redis(redisConfig);

    pubClient.on('connect', () => {
      this.logger.log('Redis pub client connected for WebSocket');
    });

    subClient.on('connect', () => {
      this.logger.log('Redis sub client connected for WebSocket');
    });

    pubClient.on('error', (err) => {
      this.logger.error(`Redis pub client error: ${err.message}`);
    });

    subClient.on('error', (err) => {
      this.logger.error(`Redis sub client error: ${err.message}`);
    });

    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3001'],
        credentials: true,
      },
    });

    server.adapter(this.adapterConstructor);
    return server;
  }
}
