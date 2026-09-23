import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { S3Service } from '@htownautos/common';
import { SocialIngestService, SocialNotifierService, SocialTokenService } from '@htownautos/social';
import { MetaWebhookController } from './meta-webhook.controller';
import { MetaWebhookService } from './meta-webhook.service';

/**
 * `/social/webhooks/meta` — Messenger/Instagram/WhatsApp Cloud inbound
 * webhook (package B3/B5, docs/social-suite/CONTRACT.md §3.7). `SocialRealtimeService`
 * is `@Global()` (imported once via `SocialRealtimeModule` in `app.module.ts`) —
 * not listed here, only plain per-module injectables are.
 */
@Module({
  imports: [PrismaModule],
  controllers: [MetaWebhookController],
  providers: [MetaWebhookService, S3Service, SocialIngestService, SocialNotifierService, SocialTokenService],
})
export class SocialWebhooksModule {}
