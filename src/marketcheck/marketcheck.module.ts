import { Module } from '@nestjs/common';
import { MarketCheckService } from './marketcheck.service';
import { MarketCheckController } from './marketcheck.controller';
import { PrismaModule } from '../prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MarketCheckController],
  providers: [MarketCheckService],
  exports: [MarketCheckService],
})
export class MarketCheckModule {}
