import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '@htownautos/auth';
import { PricePredictionService } from './price-prediction.service';

/**
 * Precio esperado para un lote aun no rematado. `@Public()` para seguir el mismo
 * patron que el resto de datos de subasta (no son datos de tenant).
 */
@ApiTags('Price Prediction')
@Controller('price-prediction')
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class PricePredictionController {
  constructor(private readonly service: PricePredictionService) {}

  @Get(':lot')
  @Public()
  @ApiOperation({ summary: 'Predicted hammer price for a lot that has not sold yet' })
  @ApiParam({ name: 'lot', description: 'Copart lot number' })
  @ApiResponse({ status: 200, description: 'Expected price + calibrated 80% interval' })
  @ApiResponse({ status: 503, description: 'The model service is unreachable' })
  predict(@Param('lot') lot: string) {
    return this.service.predict(lot);
  }
}
