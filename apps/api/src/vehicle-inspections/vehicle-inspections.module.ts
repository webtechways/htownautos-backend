import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { NotificationsModule } from '../notifications/notifications.module';
import { S3Service } from '@htownautos/common';
import { VehicleInspectionsController } from './vehicle-inspections.controller';
import { VehicleInspectionsService } from './vehicle-inspections.service';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [VehicleInspectionsController],
  // S3Service is provided directly (it's a stateless helper, no module-
  // level config). Used by the delete pipeline to clean up media.
  providers: [VehicleInspectionsService, S3Service],
  exports: [VehicleInspectionsService],
})
export class VehicleInspectionsModule {}
