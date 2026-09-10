import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { NotificationChannelsService } from './notification-channels.service';
import { NotificationChannelsController } from './notification-channels.controller';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationChannelsController],
  providers: [NotificationChannelsService],
  exports: [NotificationChannelsService],
})
export class NotificationChannelsModule {}
