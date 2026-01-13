import { Module } from '@nestjs/common';
import { VehicleTrimService } from './vehicle-trim.service';
import { VehicleTrimController } from './vehicle-trim.controller';
import { PrismaModule } from '../prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [VehicleTrimController],
  providers: [VehicleTrimService],
  exports: [VehicleTrimService],
})
export class VehicleTrimModule {}
