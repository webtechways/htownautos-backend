import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '@htownautos/prisma';
import { OpenSearchLibModule } from '@htownautos/opensearch';
import { RabbitMQModule } from '@htownautos/rabbitmq';
import { SocialRealtimeModule } from '@htownautos/social';
import {
  ProxyService,
  CopartImagesService,
  PublicS3Service,
  S3Service,
  AgentAssignmentService,
  RunpodService,
} from '@htownautos/common';
import { CopartImportService } from './copart-import.service';
import { SyncTriggerListener } from './sync-trigger.listener';
import { AuctionFramesConsumer } from './auction-frames.consumer';
import { AuctionFramesRetentionService } from './auction-frames-retention.service';
import { DbBackupService } from './db-backup.service';
import { EnvBackupService } from './env-backup.service';
import { WantedMatchNotifierService } from './wanted-match-notifier.service';
import { SellerClassificationNotifierService } from './seller-classification-notifier.service';
import { AuctionAliasNotifierService } from './auction-alias-notifier.service';
import { ImageCacheEnqueuerService } from './image-cache-enqueuer.service';
import { ImageCacheCrawlerService } from './image-cache-crawler.service';
import { ImageRetentionService } from './image-retention.service';
import { EmbedJobService } from './embed-job.service';
import { EmbedJobWatchdogService } from './embed-job-watchdog.service';
import { ChatDispatchConsumer } from './chat-dispatch.consumer';
import { ChatNotifierService } from './chat-notifier.service';
import { SocialJobsModule } from './social/social-jobs.module';
import { IdentityClerkPushConsumer } from './identity/identity-clerk-push.consumer';
import { IdentitySyncSweepService } from './identity/identity-sync-sweep.service';
import { IdentityQuotaNotifierService } from './identity/identity-quota-notifier.service';
import { ClerkEventsConsumer } from './identity/clerk-events.consumer';
import { ClerkEventsSweepService } from './identity/clerk-events-sweep.service';
import { PortalSignupNotifierService } from './identity/portal-signup-notifier.service';


@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    OpenSearchLibModule,
    RabbitMQModule,
    SocialRealtimeModule,
    SocialJobsModule,
  ],
  providers: [
    CopartImportService,
    SyncTriggerListener,
    AuctionFramesConsumer,
    AuctionFramesRetentionService,
    ChatDispatchConsumer,
    ChatNotifierService,
    IdentityClerkPushConsumer,
    IdentitySyncSweepService,
    IdentityQuotaNotifierService,
    ClerkEventsConsumer,
    ClerkEventsSweepService,
    PortalSignupNotifierService,
    DbBackupService,
    EnvBackupService,
    WantedMatchNotifierService,
    SellerClassificationNotifierService,
    AuctionAliasNotifierService,
    ImageCacheEnqueuerService,
    ImageCacheCrawlerService,
    ImageRetentionService,
    RunpodService,
    EmbedJobService,
    EmbedJobWatchdogService,
    AgentAssignmentService,
    PublicS3Service,
    // Perfil privado: ahi van los volcados de la base.
    S3Service,
    CopartImagesService,
    ProxyService,
  ],
})
export class AppModule {}
