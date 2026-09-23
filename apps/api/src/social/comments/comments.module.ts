import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { SocialNotifierService, SocialTokenService } from '@htownautos/social';
import { SocialCommentsController } from './comments.controller';
import { SocialCommentsService } from './comments.service';

/**
 * Community: comments, mentions, reviews (CONTRACT.md §3.6). `SocialTokenService`
 * needs `SocialNotifierService` (not `@Global()` — must be listed here, same as
 * `posts.module.ts`/`webhooks.module.ts`); `SocialRealtimeService`/`RabbitMQService`
 * are `@Global()` already, registered once in `app.module.ts`.
 */
@Module({
  imports: [PrismaModule],
  controllers: [SocialCommentsController],
  providers: [SocialCommentsService, SocialTokenService, SocialNotifierService],
})
export class SocialCommentsModule {}
