import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { SocialIngestService, SocialNotifierService, SocialTokenService } from '@htownautos/social';
import { CommunityPollService } from './community-poll.service';

/**
 * Comment/mention/review pollers (CONTRACT.md §4 "Comment pollers" row).
 * `SocialRealtimeService`/`RabbitMQService` are `@Global()` singletons
 * (registered once in `app.module.ts`), so they're injected directly by
 * `CommunityPollService` without appearing in `imports` here.
 */
@Module({
  imports: [PrismaModule],
  providers: [SocialTokenService, SocialIngestService, SocialNotifierService, CommunityPollService],
})
export class SocialCommunityJobsModule {}
