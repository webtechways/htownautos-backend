import { Module } from '@nestjs/common';
import { VehicleService } from './vehicle.service';
import { VehicleController } from './vehicle.controller';
import { VehiclePublicController } from './vehicle-public.controller';
import { VehiclePartsController } from './vehicle-parts.controller';
import { VehiclePartsService } from './vehicle-parts.service';
import { PrismaModule } from '../prisma.module';
import { MetaModule } from '../meta/meta.module';

/**
 * Vehicle Module
 * Encapsulates all vehicle-related functionality
 */
@Module({
  imports: [PrismaModule, MetaModule],
  controllers: [VehicleController, VehiclePublicController, VehiclePartsController],
  providers: [VehicleService, VehiclePartsService],
  exports: [VehicleService, VehiclePartsService],
})
export class VehicleModule {}
