import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { PricePredictionController } from './price-prediction.controller';
import { PricePredictionService } from './price-prediction.service';
import { BulkPredictService } from './bulk-predict.service';
import { EmbedJobsModule } from '../embed-jobs/embed-jobs.module';

@Module({
  imports: [PrismaModule, EmbedJobsModule],
  controllers: [PricePredictionController],
  providers: [PricePredictionService, BulkPredictService],
  exports: [PricePredictionService, BulkPredictService],
})
export class PricePredictionModule {}
