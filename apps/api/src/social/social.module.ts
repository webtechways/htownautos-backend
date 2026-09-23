import { Module, OnModuleInit } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { RabbitMQService } from '@htownautos/rabbitmq';
import { SocialRealtimeService, SOCIAL_REALTIME_QUEUE, type SocialRealtimeQueueMessage } from '@htownautos/social';
import { SocialSettingsModule } from './settings/social-settings.module';
import { SocialMediaModule } from './media/media.module';
import { SocialPostsModule } from './posts/posts.module';
import { SocialOrganizeModule } from './organize/organize.module';
import { SocialCommentsModule } from './comments/comments.module';
import { SocialInsightsModule } from './insights/insights.module';
import { SocialStartPagesModule } from './start-pages/start-pages.module';
import { SocialWebhooksModule } from './webhooks/webhooks.module';

/**
 * Root module for the Social Suite (`/social/**`, plus the extended
 * `/social-accounts` in its own pre-existing module). Only `settings/` is a
 * real implementation in this package (B1); the rest are placeholders other
 * packages fill in — see docs/social-suite/CONTRACT.md §6.
 *
 * Also owns the api-side half of the realtime bridge: consumes
 * `SOCIAL_REALTIME_QUEUE` (what data-sync publishes to, since it has no
 * Socket.IO server) and re-emits into the local `tenant:<id>` room via
 * `SocialRealtimeService.emitLocal`. `SocialRealtimeService` is a `@Global()`
 * singleton (see `@htownautos/social`'s `SocialRealtimeModule`, imported once
 * in `app.module.ts`) — the OTHER half of the bridge is `PresenceGateway`
 * calling `setServer()` on that same instance from its own `afterInit()`.
 */
@Module({
  imports: [
    PrismaModule,
    SocialSettingsModule,
    SocialMediaModule,
    SocialPostsModule,
    SocialOrganizeModule,
    SocialCommentsModule,
    SocialInsightsModule,
    SocialStartPagesModule,
    SocialWebhooksModule,
  ],
})
export class SocialModule implements OnModuleInit {
  constructor(
    private readonly socialRealtime: SocialRealtimeService,
    private readonly rabbitMQ: RabbitMQService,
  ) {}

  onModuleInit() {
    this.rabbitMQ
      .consume(SOCIAL_REALTIME_QUEUE, async (raw) => {
        const msg = raw as unknown as SocialRealtimeQueueMessage;
        if (!msg?.tenantId || !msg.event) return;
        this.socialRealtime.emitLocal(msg.tenantId, msg.event, msg.payload);
      })
      .catch(() => undefined); // best-effort — RabbitMQ being down at boot must not crash the api
  }
}
