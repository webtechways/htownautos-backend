import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { SocialTokenService, SocialNotifierService } from '@htownautos/social';
import { SocialMetricsJobsService } from './metrics-jobs.service';

/**
 * Metrics jobs (CONTRACT.md §4 "Metrics" row, package B7): account daily
 * snapshot at 03:00 America/Chicago + post metrics every 6h.
 * `SocialTokenService` needs `SocialNotifierService` (not `@Global()` — must
 * be listed here, same as `community-jobs.module.ts`); `SocialRealtimeService`/
 * `RabbitMQService` are `@Global()` singletons imported once in
 * `apps/data-sync/src/app.module.ts`, so they're not listed here even though
 * `SocialTokenService`/`SocialNotifierService` inject them directly.
 */
@Module({
  imports: [PrismaModule],
  providers: [SocialTokenService, SocialNotifierService, SocialMetricsJobsService],
  exports: [SocialMetricsJobsService],
})
export class SocialInsightsJobsModule {}
