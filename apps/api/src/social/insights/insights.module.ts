import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { SocialNotifierService, SocialTokenService } from '@htownautos/social';
import { SocialSettingsModule } from '../settings/social-settings.module';
import { SocialMediaModule } from '../media/media.module';
import { SocialInsightsController } from './insights.controller';
import { SocialInsightsService } from './insights.service';

/**
 * Insights (CONTRACT.md §3.8, package B7). `SocialSettingsModule` exports
 * `SocialAccessService` (admin check for `POST /sync`, default timezone for
 * best-times); `SocialMediaModule` exports `MediaResolverService` (same
 * pattern as `posts.module.ts`). `SocialTokenService` needs
 * `SocialNotifierService` (not `@Global()`, see `comments.module.ts`).
 */
@Module({
  imports: [PrismaModule, SocialSettingsModule, SocialMediaModule],
  controllers: [SocialInsightsController],
  providers: [SocialInsightsService, SocialTokenService, SocialNotifierService],
})
export class SocialInsightsModule {}
