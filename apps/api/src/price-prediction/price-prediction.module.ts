import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { PricePredictionController } from './price-prediction.controller';
import { PricePredictionService } from './price-prediction.service';
import { BulkPredictService } from './bulk-predict.service';

@Module({
  imports: [PrismaModule],
  controllers: [PricePredictionController],
  providers: [PricePredictionService, BulkPredictService],
  exports: [PricePredictionService, BulkPredictService],
})
export class PricePredictionModule {}
