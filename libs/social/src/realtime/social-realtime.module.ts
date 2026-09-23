import { Global, Module } from '@nestjs/common';
import { RabbitMQModule } from '@htownautos/rabbitmq';
import { SocialRealtimeService } from './social-realtime.service';

/**
 * `@Global()` so `SocialRealtimeService` is a single shared instance across
 * the whole api process: `PresenceGateway.afterInit()` calls `setServer()` on
 * it, and `SocialModule`'s `SOCIAL_REALTIME_QUEUE` consumer calls
 * `emitLocal()` on it — both must resolve to the exact same instance, or the
 * bridge silently does nothing. Imported once in `apps/api/src/app.module.ts`
 * (data-sync never imports this — it has no Socket.IO server to hand it).
 */
@Global()
@Module({
  imports: [RabbitMQModule],
  providers: [SocialRealtimeService],
  exports: [SocialRealtimeService],
})
export class SocialRealtimeModule {}
