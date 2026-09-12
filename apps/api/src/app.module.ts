import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';

// Shared libraries
import { PrismaModule } from '@htownautos/prisma';
import { RedisModule } from '@htownautos/redis';
import { RabbitMQModule } from '@htownautos/rabbitmq';
import { AuditModule } from '@htownautos/common';
import { AuthModule } from '@htownautos/auth';
import { MediaModule } from '@htownautos/media'; // Temporal: hasta desacoplar con RabbitMQ
import { CarfaxAnalyzerModule } from '@htownautos/carfax-analyzer'; // Temporal: hasta desacoplar con RabbitMQ
import { DamageDetectorModule } from '@htownautos/damage-detector'; // Temporal: hasta desacoplar con RabbitMQ

// API modules
import { VehicleYearModule } from './vehicle-year/vehicle-year.module';
import { VehicleMakeModule } from './vehicle-make/vehicle-make.module';
import { VehicleModelModule } from './vehicle-model/vehicle-model.module';
import { VehicleTrimModule } from './vehicle-trim/vehicle-trim.module';
import { NomenclatorsModule } from './nomenclators/nomenclators.module';
import { ExtraExpenseModule } from './extra-expense/extra-expense.module';
import { VehicleModule } from './vehicle/vehicle.module';
import { DealModule } from './deal/deal.module';
import { MetaModule } from './meta/meta.module';
import { RolesModule } from './roles/roles.module';
import { TenantModule } from './tenant/tenant.module';
import { PartsModule } from './parts/parts.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { TitleModule } from './title/title.module';
import { MarketCheckModule } from './marketcheck/marketcheck.module';
import { PartsPricingModule } from './parts-pricing/parts-pricing.module';
import { MaxBidModule } from './max-bid/max-bid.module';
import { UploadSessionModule } from './upload-session/upload-session.module';
import { CopartModule } from './copart/copart.module';
import { FavoritesModule } from './favorites/favorites.module';
import { BuyersModule } from './buyers/buyers.module';
import { BuyerAuctionBidsModule } from './buyer-auction-bids/buyer-auction-bids.module';
import { BuyerVehiclePreferencesModule } from './buyer-vehicle-preferences/buyer-vehicle-preferences.module';
import { BuyerFavoritesModule } from './buyer-favorites/buyer-favorites.module';
import { VehicleInspectionsModule } from './vehicle-inspections/vehicle-inspections.module';
import { InspectionShareLinksModule } from './inspection-share-links/inspection-share-links.module';
import { YardsModule } from './yards/yards.module';
import { AuctionSaleResultsModule } from './auction-sale-results/auction-sale-results.module';
import { EmailModule } from './email/email.module';
import { TasksModule } from './tasks/tasks.module';
import { NotesModule } from './notes/notes.module';
import { PhoneCallsModule } from './phone-calls/phone-calls.module';
import { SmsModule } from './sms/sms.module';
import { EmailMessagesModule } from './email-messages/email-messages.module';
import { PresenceModule } from './presence/presence.module';
import { TwilioModule } from './twilio/twilio.module';
import { CallFlowModule } from './call-flow/call-flow.module';
import { OpenSearchModule } from './opensearch/opensearch.module';
import { TitleMappingModule } from './title-mapping/title-mapping.module';
import { SellerClassificationModule } from './seller-classification/seller-classification.module';
import { AuctionAliasModule } from './auction-alias/auction-alias.module';
import { StripeModule } from './stripe/stripe.module';
import { ShortUrlModule } from './short-url/short-url.module';
import { ProxySyncModule } from './proxy-sync/proxy-sync.module';
import { ImageCacheModule } from './image-cache/image-cache.module';
import { NewLotsStatsModule } from './new-lots-stats/new-lots-stats.module';
import { AuctionCalendarModule } from './auction-calendar/auction-calendar.module';
import { AuctionMonitorModule } from './auction-monitor/auction-monitor.module';
import { ScraperAgentsModule } from './scraper-agents/scraper-agents.module';
import { ScraperWorkersModule } from './scraper-workers/scraper-workers.module';
import { ListingGroupsModule } from './listing-groups/listing-groups.module';
import { ListingReviewsModule } from './listing-reviews/listing-reviews.module';
import { RebuildModule } from './rebuild/rebuild.module';
import { InventoryAssetsModule } from './inventory-assets/inventory-assets.module';
import { InvestmentsModule } from './investments/investments.module';
import { SocialAccountsModule } from './social-accounts/social-accounts.module';
import { NotificationChannelsModule } from './notification-channels/notification-channels.module';
import { AiChatModule } from './ai-chat/ai-chat.module';
import { ClerkWebhooksModule } from './clerk-webhooks/clerk-webhooks.module';
import { ShippoModule } from './shippo/shippo.module';
import { ParcelTemplatesModule } from './parcel-templates/parcel-templates.module';
import { PartOrdersModule } from './part-orders/part-orders.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { PostmarkModule } from './postmark/postmark.module';
import { CloudflareModule } from './cloudflare/cloudflare.module';
import { PortalModule } from './portal/portal.module';
import { AuctionHistoryModule } from './auction-history/auction-history.module';
import { AdminSeedModule } from './admin-seed/admin-seed.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ContactMessagesModule } from './contact-messages/contact-messages.module';
import { AiTranslateModule } from './ai-translate/ai-translate.module';
import { SyncWatchdogModule } from './sync-watchdog/sync-watchdog.module';

/**
 * API Gateway Module
 * - Rate limiting global
 * - Audit logging
 * - Input validation
 */
@Module({
  imports: [
    // Rate Limiting
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 300 },
      { name: 'medium', ttl: 60000, limit: 1000 },
      { name: 'long', ttl: 3600000, limit: 20000 },
    ]),

    // Cron jobs
    ScheduleModule.forRoot(),

    // Shared libs
    PrismaModule,
    RedisModule,
    RabbitMQModule,
    AuditModule,
    AuthModule,

    // Media & AI (temporal: se elimina cuando se desacople con RabbitMQ)
    MediaModule,
    CarfaxAnalyzerModule,
    DamageDetectorModule,

    // Business modules
    VehicleYearModule,
    VehicleMakeModule,
    VehicleModelModule,
    VehicleTrimModule,
    VehicleModule,
    DealModule,
    NomenclatorsModule,
    ExtraExpenseModule,
    MetaModule,
    RolesModule,
    TenantModule,
    PartsModule,
    TitleModule,
    AuditLogModule,
    MarketCheckModule,
    PartsPricingModule,
    MaxBidModule,
    UploadSessionModule,
    CopartModule,
    FavoritesModule,
    BuyersModule,
    BuyerAuctionBidsModule,
    BuyerVehiclePreferencesModule,
    BuyerFavoritesModule,
    VehicleInspectionsModule,
    InspectionShareLinksModule,
    YardsModule,
    AuctionSaleResultsModule,
    EmailModule,
    TasksModule,
    NotesModule,
    PhoneCallsModule,
    SmsModule,
    EmailMessagesModule,
    PresenceModule,
    TwilioModule,
    CallFlowModule,
    OpenSearchModule,
    TitleMappingModule,
    SellerClassificationModule,
    AuctionAliasModule,
    StripeModule,
    ShortUrlModule,
    ProxySyncModule,
    ImageCacheModule,
    NewLotsStatsModule,
    AuctionCalendarModule,
    AuctionMonitorModule,
    ScraperAgentsModule,
    ScraperWorkersModule,
    ListingGroupsModule,
    ListingReviewsModule,
    RebuildModule,
    InventoryAssetsModule,
    InvestmentsModule,
    SocialAccountsModule,
    NotificationChannelsModule,
    AiChatModule,
    ClerkWebhooksModule,
    ShippoModule,
    ParcelTemplatesModule,
    PartOrdersModule,
    ApiKeysModule,
    PostmarkModule,
    CloudflareModule,
    PortalModule,
    AuctionHistoryModule,
    AdminSeedModule,
    NotificationsModule,
    ContactMessagesModule,
    AiTranslateModule,
    SyncWatchdogModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
