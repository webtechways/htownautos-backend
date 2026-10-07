import { Module } from '@nestjs/common';
import { RabbitMQModule } from '@htownautos/rabbitmq';
import { PrismaModule } from '@htownautos/prisma';
import { TitleMappingModule } from '../title-mapping/title-mapping.module';
import { AuctionSaleResultsController } from './auction-sale-results.controller';
import { AuctionSaleResultsService } from './auction-sale-results.service';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';
import { VocabularyService } from './vocabulary.service';
import { AuctionFramesService } from './auction-frames.service';
import { AuctionFramesController } from './auction-frames.controller';
import { ExtensionLogsService } from './extension-logs.service';
import { BroadcastRoomsService } from './broadcast-rooms.service';

@Module({
  imports: [RabbitMQModule, PrismaModule, TitleMappingModule],
  controllers: [
    AuctionFramesController,AuctionSaleResultsController, StatsController],
  providers: [
    AuctionFramesService,AuctionSaleResultsService, StatsService, VocabularyService, ExtensionLogsService, BroadcastRoomsService],
  exports: [AuctionSaleResultsService, StatsService, VocabularyService],
})
export class AuctionSaleResultsModule {}
