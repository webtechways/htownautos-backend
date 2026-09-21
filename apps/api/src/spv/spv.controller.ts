import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SpvService } from './spv.service';

/**
 * Standard Presumptive Value por VIN.
 *
 * Sin `@Public()`: detras del guard global como el resto del dashboard. Es una
 * puerta a un servicio del estado, y dejarla abierta seria regalar un proxy de
 * scraping a cualquiera que encuentre la URL.
 *
 * El limite de peticiones es bajo a proposito, por la misma razon.
 */
@ApiTags('SPV')
@Controller('spv')
export class SpvController {
  constructor(private readonly service: SpvService) {}

  @Get()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Valor presuntivo estandar de un vehiculo',
    description:
      'Por ahora solo TX, donde se consulta la calculadora de TxDMV y se ' +
      'devuelve ya parseado. Las respuestas se guardan una semana, que es cada ' +
      'cuanto TxDMV recalcula los valores.',
  })
  @ApiQuery({ name: 'vin', example: '5TDKDRBH0PS029803' })
  @ApiQuery({ name: 'odometer', example: 85000 })
  @ApiQuery({ name: 'state', required: false, example: 'TX' })
  @ApiResponse({ status: 200, description: 'Año, marca, modelo y valor en dolares' })
  @ApiResponse({ status: 400, description: 'VIN u odometro invalidos, o TxDMV los rechazo' })
  @ApiResponse({ status: 501, description: 'Estado todavia no soportado' })
  @ApiResponse({ status: 503, description: 'TxDMV no responde o cambio su pagina' })
  lookup(
    @Query('vin') vin: string,
    @Query('odometer') odometer: string,
    @Query('state') state?: string,
  ) {
    return this.service.lookup({ vin, odometer, state });
  }
}
