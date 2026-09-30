import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { MarketCheckService } from './marketcheck.service';
import { MarketCheckController } from './marketcheck.controller';

@Module({
  imports: [PrismaModule],
  controllers: [MarketCheckController],
  providers: [MarketCheckService],
  exports: [MarketCheckService],
})
export class MarketCheckModule {}
