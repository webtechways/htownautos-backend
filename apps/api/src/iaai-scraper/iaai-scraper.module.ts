import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { IaaiScraperController } from './iaai-scraper.controller';
import { IaaiScraperService } from './iaai-scraper.service';
import { IaaiListingsController } from './iaai-listings.controller';
import { IaaiListingsService } from './iaai-listings.service';

// PrismaModule is required because ClerkJwtGuard injects PrismaService.
@Module({
  imports: [PrismaModule],
  controllers: [IaaiScraperController, IaaiListingsController],
  providers: [IaaiScraperService, IaaiListingsService],
})
export class IaaiScraperModule {}
