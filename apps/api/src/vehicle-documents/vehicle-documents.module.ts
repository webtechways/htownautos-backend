import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { S3Service } from '@htownautos/common';
import { DocusealClient } from './docuseal.client';
import { VehicleDocumentsController } from './vehicle-documents.controller';
import { VehicleDocumentsService } from './vehicle-documents.service';

@Module({
  imports: [PrismaModule],
  controllers: [VehicleDocumentsController],
  providers: [VehicleDocumentsService, DocusealClient, S3Service],
  exports: [VehicleDocumentsService],
})
export class VehicleDocumentsModule {}
