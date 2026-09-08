import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '@htownautos/prisma';
import { OpenSearchLibModule } from '@htownautos/opensearch';
import { RabbitMQModule } from '@htownautos/rabbitmq';
import {
  ProxyService,
  CopartImagesService,
  PublicS3Service,
  AgentAssignmentService,
} from '@htownautos/common';
import { CopartImportService } from './copart-import.service';
import { SyncTriggerListener } from './sync-trigger.listener';
import { AuctionFramesConsumer } from './auction-frames.consumer';
import { WantedMatchNotifierService } from './wanted-match-notifier.service';
import { SellerClassificationNotifierService } from './seller-classification-notifier.service';
import { AuctionAliasNotifierService } from './auction-alias-notifier.service';
import { ImageCacheEnqueuerService } from './image-cache-enqueuer.service';
import { ImageCacheCrawlerService } from './image-cache-crawler.service';
import { ImageRetentionService } from './image-retention.service';


@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    OpenSearchLibModule,
    RabbitMQModule,
  ],
  providers: [
    CopartImportService,
    SyncTriggerListener,
    AuctionFramesConsumer,
    WantedMatchNotifierService,
    SellerClassificationNotifierService,
    AuctionAliasNotifierService,
    ImageCacheEnqueuerService,
    ImageCacheCrawlerService,
    ImageRetentionService,
    AgentAssignmentService,
    PublicS3Service,
    CopartImagesService,
    ProxyService,
  ],
})
export class AppModule {}
