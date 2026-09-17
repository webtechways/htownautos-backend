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
  requestRun(@Body() body?: { todo?: boolean }) {
    return this.service.requestRun(body?.todo === true);
  }

  @Get('selection-preview')
  @ApiOperation({ summary: 'Cuantos lotes cogeria cada grupo con los filtros de ahora' })
  selectionPreview() {
    return this.service.selectionPreview();
  }

  @Get('training/status')
  @ApiOperation({ summary: 'Estado y historial del reentrenamiento del modelo' })
  trainingStatus() {
    return this.service.trainingStatus();
  }

  @Post('training/run')
  @ApiOperation({ summary: 'Reentrenar el modelo con la ventana movil de dias' })
  startTraining(@Body() body: { days?: number; force?: boolean }) {
    return this.service.startTraining(body?.days, body?.force === true);
  }

  @Post('kill-all')
  @ApiOperation({ summary: 'Apagado de emergencia: borra todos nuestros pods' })
  @ApiResponse({ status: 201, description: 'Ids borrados y fallidos' })
  killAll() {
    return this.service.killAll();
  }
}
