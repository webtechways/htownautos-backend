import { Module } from '@nestjs/common';
import { VehicleTrimService } from './vehicle-trim.service';
import { VehicleTrimController } from './vehicle-trim.controller';
import { PrismaModule } from '../prisma.module';
import { MarketCheckModule } from '../marketcheck/marketcheck.module';

@Module({
  imports: [PrismaModule, MarketCheckModule],
  controllers: [VehicleTrimController],
  providers: [VehicleTrimService],
  exports: [VehicleTrimService],
})
export class VehicleTrimModule {}
