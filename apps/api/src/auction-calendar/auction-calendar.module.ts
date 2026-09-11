import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { RabbitMQModule } from '@htownautos/rabbitmq';
import { ProxyService, AgentAssignmentService } from '@htownautos/common';
import { AuctionCalendarService } from './auction-calendar.service';
import { AuctionCalendarController } from './auction-calendar.controller';
import { AuctionCalendarAlertsService } from './auction-calendar-alerts.service';

// PrismaModule required because ClerkJwtGuard injects PrismaService.
// ProxyService fetches AutoBidMaster through the rotating proxy pool.
@Module({
  imports: [PrismaModule, RabbitMQModule],
  controllers: [AuctionCalendarController],
  providers: [
    AuctionCalendarService,
    AuctionCalendarAlertsService,
    ProxyService,
    AgentAssignmentService,
  ],
})
export class AuctionCalendarModule {}
