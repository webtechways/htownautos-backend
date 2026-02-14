import { Module, Global } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PresenceService } from './presence.service';
import { PresenceController } from './presence.controller';
import { PresenceInterceptor } from './presence.interceptor';
import { PresenceGateway } from './presence.gateway';
import { PrismaModule } from '../prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [PresenceController],
  providers: [
    PresenceService,
    PresenceGateway,
    // Register interceptor globally to track all API activity
    {
      provide: APP_INTERCEPTOR,
      useClass: PresenceInterceptor,
    },
  ],
  exports: [PresenceService, PresenceGateway],
})
export class PresenceModule {}
