import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { S3Service } from '@htownautos/common';
import { VehicleHistoryService } from './vehicle-history.service';
import { VehicleHistoryAdminService } from './vehicle-history-admin.service';
import { VehicleHistoryController } from './vehicle-history.controller';
import { VehicleHistoryWebhookService } from './vehicle-history-webhooks.service';
import { VehicleHistoryLibraryService } from './vehicle-history-library.service';

@Module({
  imports: [PrismaModule],
  controllers: [VehicleHistoryController],
  providers: [VehicleHistoryService, VehicleHistoryAdminService, VehicleHistoryWebhookService, VehicleHistoryLibraryService, S3Service],
  exports: [VehicleHistoryService],
})
export class VehicleHistoryModule {}
