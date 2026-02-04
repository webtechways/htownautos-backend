import { Module } from '@nestjs/common';
import { VehicleModelService } from './vehicle-model.service';
import { VehicleModelController } from './vehicle-model.controller';
import { PrismaModule } from '../prisma.module';
import { MarketCheckModule } from '../marketcheck/marketcheck.module';

@Module({
  imports: [PrismaModule, MarketCheckModule],
  controllers: [VehicleModelController],
  providers: [VehicleModelService],
  exports: [VehicleModelService],
})
export class VehicleModelModule {}
