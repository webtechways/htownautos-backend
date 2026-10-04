import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { IaaiScraperController } from './iaai-scraper.controller';
import { IaaiScraperService } from './iaai-scraper.service';

// PrismaModule is required because ClerkJwtGuard injects PrismaService.
@Module({
  imports: [PrismaModule],
  controllers: [IaaiScraperController],
  providers: [IaaiScraperService],
})
export class IaaiScraperModule {}
