import { Module } from '@nestjs/common';
import { VehicleService } from './vehicle.service';
import { VehicleController } from './vehicle.controller';
import { PrismaModule } from '../prisma.module';
import { MetaModule } from '../meta/meta.module';

/**
 * Vehicle Module
 * Encapsulates all vehicle-related functionality
 */
@Module({
  imports: [PrismaModule, MetaModule],
  controllers: [VehicleController],
  providers: [VehicleService],
  exports: [VehicleService],
})
export class VehicleModule {}
