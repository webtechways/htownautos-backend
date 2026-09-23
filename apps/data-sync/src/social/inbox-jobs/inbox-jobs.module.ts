import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { SocialIngestService, SocialNotifierService, SocialTokenService } from '@htownautos/social';
import { DmPollService } from './dm-poll.service';

/**
 * DM pollers (CONTRACT.md §4 "DM pollers" row, every 2 min): X, Bluesky,
 * Mastodon — package B3/B5. `SocialRealtimeService` is `@Global()` (imported
 * once via `SocialRealtimeModule` in `apps/data-sync/src/app.module.ts`) —
 * not listed here, only plain per-module injectables are.
 */
@Module({
  imports: [PrismaModule],
  providers: [DmPollService, SocialTokenService, SocialNotifierService, SocialIngestService],
})
export class SocialInboxJobsModule {}
