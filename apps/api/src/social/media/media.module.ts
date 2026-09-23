import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { S3Service } from '@htownautos/common';
import { MediaResolverService } from '@htownautos/social';
import { SocialMediaController } from './media.controller';
import { SocialMediaService } from './media.service';

@Module({
  imports: [PrismaModule],
  controllers: [SocialMediaController],
  providers: [SocialMediaService, S3Service, MediaResolverService],
  exports: [SocialMediaService, MediaResolverService],
})
export class SocialMediaModule {}
