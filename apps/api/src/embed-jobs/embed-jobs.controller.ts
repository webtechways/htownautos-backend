import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { EmbedJobsService } from './embed-jobs.service';

/**
 * Panel de Auction Data → Vectores de Imagen.
 *
 * Sin `@Public()`: esto alquila GPUs y las apaga, asi que va tras el guard global
 * como el resto del dashboard.
 */
@ApiTags('Image Vectors')
@Controller('embed-jobs')
export class EmbedJobsController {
  constructor(private readonly service: EmbedJobsService) {}

  @Get('status')
  @ApiOperation({ summary: 'Estado del job, cobertura, coste y pods vivos' })
  status() {
    return this.service.status();
  }

  @Get('runs/:id')
  @ApiOperation({ summary: 'Detalle y log completo de una ejecucion' })
  run(@Param('id') id: string) {
    return this.service.runDetail(id);
  }

  @Patch('config')
  @ApiOperation({ summary: 'Cambiar ajustes del job' })
  updateConfig(@Body() body: Record<string, unknown>) {
    return this.service.updateConfig(body);
  }

  @Post('run')
  @ApiOperation({ summary: 'Pedir una ejecucion ahora (data-sync la recoge en <1 min)' })
  requestRun() {
    return this.service.requestRun();
  }

  @Post('kill-all')
  @ApiOperation({ summary: 'Apagado de emergencia: borra todos nuestros pods' })
  @ApiResponse({ status: 201, description: 'Ids borrados y fallidos' })
  killAll() {
    return this.service.killAll();
  }
}
