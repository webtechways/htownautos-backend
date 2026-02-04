import { Module } from '@nestjs/common';
import { VehicleMakeService } from './vehicle-make.service';
import { VehicleMakeController } from './vehicle-make.controller';
import { PrismaModule } from '../prisma.module';
import { MarketCheckModule } from '../marketcheck/marketcheck.module';

@Module({
  imports: [PrismaModule, MarketCheckModule],
  controllers: [VehicleMakeController],
  providers: [VehicleMakeService],
  exports: [VehicleMakeService],
})
export class VehicleMakeModule {}
