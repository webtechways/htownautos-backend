import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { SocialMediaModule } from '../media/media.module';
import { SocialStartPagesController } from './start-pages.controller';
import { SocialStartPagesService } from './start-pages.service';

/**
 * Start pages / "link in bio" (CONTRACT.md §3.9, package B7).
 * `SocialMediaModule` exports `MediaResolverService` (avatar/block image
 * signed URLs), same pattern as `insights.module.ts`/`posts.module.ts`.
 */
@Module({
  imports: [PrismaModule, SocialMediaModule],
  controllers: [SocialStartPagesController],
  providers: [SocialStartPagesService],
})
export class SocialStartPagesModule {}
