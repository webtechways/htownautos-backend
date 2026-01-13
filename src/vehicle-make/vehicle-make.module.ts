import { Module } from '@nestjs/common';
import { VehicleMakeService } from './vehicle-make.service';
import { VehicleMakeController } from './vehicle-make.controller';
import { PrismaModule } from '../prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [VehicleMakeController],
  providers: [VehicleMakeService],
  exports: [VehicleMakeService],
})
export class VehicleMakeModule {}
