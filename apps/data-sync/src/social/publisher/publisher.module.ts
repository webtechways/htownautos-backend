import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { S3Service } from '@htownautos/common';
import { SocialTokenRefreshProvider, SocialTokenService, SocialNotifierService } from '@htownautos/social';
import { SocialPublishClaimService } from './claim.service';
import { PublishRunnerService } from './publish-runner.service';
import { PublishWorkerService } from './publish-worker.service';

/**
 * Publisher + reminders (CONTRACT.md §4 "Publisher"/"Reminders" rows).
 * `SocialTokenRefreshProvider` (B2 — tokens) was already wired here as a
 * self-contained provider; kept as-is. Everything else below is this
 * package's own: `SocialTokenService`/`SocialNotifierService`/`S3Service`
 * are plain injectables (no extra module needed — `SocialRealtimeService`
 * and `RabbitMQService` are `@Global()` already, imported once in
 * `AppModule`, so they're not listed here).
 */
@Module({
  imports: [PrismaModule],
  providers: [
    SocialTokenRefreshProvider,
    SocialTokenService,
    SocialNotifierService,
    S3Service,
    SocialPublishClaimService,
    PublishRunnerService,
    PublishWorkerService,
  ],
})
export class SocialPublisherModule {}
