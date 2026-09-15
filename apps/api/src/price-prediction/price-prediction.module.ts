import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { PricePredictionController } from './price-prediction.controller';
import { PricePredictionService } from './price-prediction.service';

@Module({
  imports: [PrismaModule],
  controllers: [PricePredictionController],
  providers: [PricePredictionService],
  exports: [PricePredictionService],
})
export class PricePredictionModule {}
