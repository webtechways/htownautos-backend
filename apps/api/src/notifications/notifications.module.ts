import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { RabbitMQModule } from '@htownautos/rabbitmq';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * NotificationsModule — staff notification feed + fan-out producer.
 *
 * Imports PrismaModule for the feed and RabbitMQModule para sacar cada
 * notificacion a los canales de chat del tenant sin bloquear la peticion.
 * Exported so any module that fires notifications (e.g. PortalModule) can
 * inject NotificationsService without circular deps.
 */
@Module({
  imports: [PrismaModule, RabbitMQModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
