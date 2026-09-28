import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { RabbitMQModule } from '@htownautos/rabbitmq';
import { StatsAuthController } from './stats-auth.controller';

@Module({
  imports: [PrismaModule, RabbitMQModule],
  controllers: [StatsAuthController],
})
export class StatsAuthModule {}
