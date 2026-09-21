import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { EmbedJobsService } from './embed-jobs.service';

/**
 * Panel de Auction Data → AI Training.
 *
 * Sin `@Public()`: esto alquila GPUs y las apaga, asi que va tras el guard global
 * como el resto del dashboard.
 */
@ApiTags('AI Training')
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
  @ApiOperation({
    summary: 'Reentrenar el modelo',
    description:
      'days=0 entrena con todo el historico; onlyWithImages lo limita a las ' +
      'ventas cuyo lote ya tiene vector de imagen (el modelo visor).',
  })
  startTraining(
    @Body()
    body: { days?: number; force?: boolean; onlyWithImages?: boolean; autoPromote?: boolean },
  ) {
    return this.service.startTraining(body ?? {});
  }

  @Post('training/cancel')
  @ApiOperation({ summary: 'Parar el entrenamiento en curso; produccion no se toca' })
  cancelTraining() {
    return this.service.cancelTraining();
  }

  @Get('corpus')
  @ApiOperation({ summary: 'Ventas con precio, con fotos y con vector: el material entrenable' })
  corpus() {
    return this.service.corpus();
  }

  @Post('pause')
  @ApiOperation({ summary: 'Pausar la ejecucion de vectores en curso (lo hecho se conserva)' })
  pause() {
    return this.service.pauseRun();
  }

  @Post('kill-all')
  @ApiOperation({ summary: 'Apagado de emergencia: borra todos nuestros pods' })
  @ApiResponse({ status: 201, description: 'Ids borrados y fallidos' })
  killAll() {
    return this.service.killAll();
  }
}
