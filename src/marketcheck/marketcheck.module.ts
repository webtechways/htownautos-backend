import { Module } from '@nestjs/common';
import { MarketCheckService } from './marketcheck.service';
import { MarketCheckController } from './marketcheck.controller';

@Module({
  controllers: [MarketCheckController],
  providers: [MarketCheckService],
  exports: [MarketCheckService],
})
export class MarketCheckModule {}
