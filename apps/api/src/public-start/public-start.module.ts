import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { SocialMediaModule } from '../social/media/media.module';
import { PublicStartController } from './public-start.controller';
import { PublicStartService } from './public-start.service';

/**
 * Public "link in bio" page (`GET/POST /public/start/:slug`, both
 * `@Public()`) — CONTRACT.md §3.9, package B7. `SocialMediaModule` exports
 * `MediaResolverService` for avatar/block image signed URLs.
 */
@Module({
  imports: [PrismaModule, SocialMediaModule],
  controllers: [PublicStartController],
  providers: [PublicStartService],
})
export class PublicStartModule {}
