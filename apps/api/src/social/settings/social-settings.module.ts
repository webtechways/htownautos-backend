import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { SocialSettingsController } from './social-settings.controller';
import { SocialSettingsService } from './social-settings.service';
import { SocialAccessService } from './social-access.service';

@Module({
  imports: [PrismaModule],
  controllers: [SocialSettingsController],
  providers: [SocialSettingsService, SocialAccessService],
  exports: [SocialAccessService],
})
export class SocialSettingsModule {}
