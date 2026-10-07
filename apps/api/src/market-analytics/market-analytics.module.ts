import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { TitleMappingModule } from '../title-mapping/title-mapping.module';
import { MarketAnalyticsController } from './market-analytics.controller';
import { MarketAnalyticsService } from './market-analytics.service';

@Module({
  imports: [PrismaModule, TitleMappingModule],
  controllers: [MarketAnalyticsController],
  providers: [MarketAnalyticsService],
})
export class MarketAnalyticsModule {}
