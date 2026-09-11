import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkJwtGuard } from '@htownautos/auth';
import { AgentAssignmentService } from '@htownautos/common';
import { AuctionCalendarService } from './auction-calendar.service';
import { UpdateCalendarConfigDto } from './dto/update-calendar-config.dto';
import { UpdateCalendarAlertsDto } from './dto/update-calendar-alerts.dto';
import { AuctionCalendarAlertsService } from './auction-calendar-alerts.service';

/**
 * AutoBidMaster auction calendar (Settings → Auction Calendar). Global, staff-only.
 */
@ApiTags('Auction calendar')
@Controller('auction-calendar')
@UseGuards(ClerkJwtGuard)
@ApiBearerAuth()
export class AuctionCalendarController {
  constructor(
    private readonly service: AuctionCalendarService,
    private readonly assignment: AgentAssignmentService,
    private readonly alerts: AuctionCalendarAlertsService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Counts per status + refresh config' })
  status() {
    return this.service.getStatus();
  }

  @Get()
  @ApiOperation({ summary: 'List calendar entries (with pre-built links)' })
  list(
    @Query('status') status?: string,
    @Query('group') group?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list({ status, group, page: Number(page), limit: Number(limit) });
  }

  @Patch('config')
  @ApiOperation({ summary: 'Update refresh cadence' })
  updateConfig(@Body() dto: UpdateCalendarConfigDto) {
    return this.service.updateConfig(dto);
  }

  @Get('alerts')
  @ApiOperation({ summary: 'Configuracion de avisos + cuantas subastas entran' })
  getAlerts() {
    return this.service.getAlerts();
  }

  @Patch('alerts')
  @ApiOperation({ summary: 'Actualizar los avisos antes del comienzo' })
  updateAlerts(@Body() dto: UpdateCalendarAlertsDto) {
    return this.service.updateAlerts(dto);
  }

  /**
   * Dispara la pasada de avisos ahora. Existe para poder comprobar que el
   * mensaje llega bien sin esperar al cron ni a que empiece una subasta.
   */
  @Post('alerts/run')
  @ApiOperation({ summary: 'Ejecutar ahora la pasada de avisos' })
  async runAlerts() {
    return { announced: await this.alerts.run() };
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Fetch the calendar from AutoBidMaster now' })
  refresh() {
    return this.service.fetchAndStore();
  }

  @Post('assign-agents')
  @ApiOperation({
    summary: 'Repartir ahora las subastas sin agente entre los agentes activos',
    description:
      'Lo mismo que hace el job diario de las 6:00 (hora de Houston): primero suelta ' +
      'las subastas ya celebradas o sin inventario, y luego reparte las próximas que ' +
      'no tengan agente. Es idempotente.',
  })
  assignAgents() {
    return this.assignment.runAssignment();
  }

  @Patch(':id/monitor')
  @ApiOperation({ summary: 'Toggle the monitor flag on a calendar entry' })
  setMonitor(@Param('id') id: string, @Body() body: { monitor: boolean }) {
    return this.service.setMonitor(id, !!body.monitor);
  }
}
