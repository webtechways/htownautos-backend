import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ADMIN_ROLES, RequireApiScopes, RequireRoles, RolesGuard } from '@htownautos/auth';
import { VehicleHistoryService } from './vehicle-history.service';
import { VehicleHistoryAdminService } from './vehicle-history-admin.service';
import { OrderReportDto, ReorderProvidersDto, TestProviderDto, UpdateProviderDto, UpdateSettingsDto } from './dto';
import { REPORT_TYPES, ReportType } from './types';

interface AuthedRequest {
  user?: { id?: string };
  tenant?: { id?: string };
  apiKey?: { id: string };
}

/**
 * Carfax / AutoCheck through the provider fallback chain.
 * Ordering and reading are open to staff and to API keys with the
 * vehicle-history scope; provider configuration is admin-only.
 */
@ApiTags('Vehicle history reports')
@ApiBearerAuth()
@Controller('vehicle-history')
export class VehicleHistoryController {
  constructor(
    private readonly history: VehicleHistoryService,
    private readonly admin: VehicleHistoryAdminService,
  ) {}

  // ── Ordering ────────────────────────────────────────────────────────────

  @Post('reports')
  @RequireApiScopes('vehicle-history:write')
  @ApiOperation({
    summary: 'Order a Carfax or AutoCheck report by VIN',
    description:
      'Served from the cache when a report for the VIN + type is recent enough (settings.cacheDays); otherwise the providers are tried in priority order until one delivers. Waits up to `wait` seconds (default 25); a request still running comes back with status "running" — poll GET /vehicle-history/requests/:id.',
  })
  order(@Body() dto: OrderReportDto, @Req() req: AuthedRequest) {
    return this.history.order(
      {
        vin: dto.vin,
        type: dto.type,
        force: dto.force,
        source: req.apiKey ? 'api' : 'crm',
        requestedBy: req.apiKey ? `api-key:${req.apiKey.id}` : req.user?.id ?? null,
        tenantId: req.tenant?.id ?? null,
      },
      (dto.wait ?? 25) * 1000,
    );
  }

  @Get('requests/:id')
  @RequireApiScopes('vehicle-history:read')
  @ApiOperation({ summary: 'State of a report order (running | completed | failed), with a view URL when completed' })
  @ApiQuery({ name: 'wait', required: false, description: 'Seconds to wait if still running (0–25)' })
  request(@Param('id') id: string, @Query('wait') wait?: string) {
    const s = Math.min(25, Math.max(0, Number(wait) || 0));
    return this.history.waitAndView(id, s * 1000);
  }

  @Get('reports')
  @RequireApiScopes('vehicle-history:read')
  @ApiOperation({ summary: 'Stored reports for a VIN, newest first' })
  @ApiQuery({ name: 'vin', required: true })
  @ApiQuery({ name: 'type', required: false, enum: REPORT_TYPES })
  reports(@Query('vin') vin: string, @Query('type') type?: string) {
    return this.history.reportsForVin(vin, REPORT_TYPES.includes(type as ReportType) ? (type as ReportType) : undefined);
  }

  // ── Admin ───────────────────────────────────────────────────────────────

  @Get('providers')
  @UseGuards(RolesGuard)
  @RequireRoles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Providers in fallback order, with toggles, key status, health and circuit state' })
  providers() {
    return this.admin.listProviders();
  }

  @Put('providers/order')
  @UseGuards(RolesGuard)
  @RequireRoles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Set the fallback order (first key runs first)' })
  reorder(@Body() dto: ReorderProvidersDto) {
    return this.admin.reorder(dto.keys);
  }

  @Patch('providers/:key')
  @UseGuards(RolesGuard)
  @RequireRoles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Enable/disable a provider or one report type, set its API key, base URL or timeout' })
  updateProvider(@Param('key') key: string, @Body() dto: UpdateProviderDto) {
    return this.admin.updateProvider(key, dto);
  }

  @Post('providers/health')
  @UseGuards(RolesGuard)
  @RequireRoles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Run the free health/balance check on every provider now' })
  async healthAll() {
    await this.history.checkAllHealth();
    return this.admin.listProviders();
  }

  @Post('providers/:key/health')
  @UseGuards(RolesGuard)
  @RequireRoles(...ADMIN_ROLES)
  @ApiOperation({ summary: "Run one provider's free health/balance check now" })
  async health(@Param('key') key: string) {
    await this.history.checkHealth(key);
    return this.admin.listProviders();
  }

  @Post('providers/:key/reset-circuit')
  @UseGuards(RolesGuard)
  @RequireRoles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Close the circuit breaker: the provider goes back to its place in the order' })
  resetCircuit(@Param('key') key: string) {
    return this.admin.resetCircuit(key);
  }

  @Post('providers/:key/test')
  @UseGuards(RolesGuard)
  @RequireRoles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Order a real report from this provider only (paid, skips the cache)' })
  test(@Param('key') key: string, @Body() dto: TestProviderDto, @Req() req: AuthedRequest) {
    return this.history.order(
      { vin: dto.vin, type: dto.type, force: true, onlyProvider: key, source: 'admin-test', requestedBy: req.user?.id ?? null, tenantId: req.tenant?.id ?? null },
      25_000,
    );
  }

  @Get('settings')
  @UseGuards(RolesGuard)
  @RequireRoles(...ADMIN_ROLES)
  settings() {
    return this.admin.getSettings();
  }

  @Patch('settings')
  @UseGuards(RolesGuard)
  @RequireRoles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Cache window, circuit breaker, health interval and log retention' })
  updateSettings(@Body() dto: UpdateSettingsDto) {
    return this.admin.updateSettings(dto);
  }

  @Get('stats')
  @UseGuards(RolesGuard)
  @RequireRoles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Per-provider and per-route call stats, served reports, fallbacks and daily volume' })
  @ApiQuery({ name: 'days', required: false, example: 7 })
  stats(@Query('days') days?: string) {
    return this.admin.stats(Number(days) || 7);
  }

  @Get('requests')
  @UseGuards(RolesGuard)
  @RequireRoles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Report orders, newest first' })
  requests(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('providerKey') providerKey?: string,
    @Query('vin') vin?: string,
    @Query('type') type?: string,
  ) {
    return this.admin.listRequests({ page: Number(page), limit: Number(limit), status, providerKey, vin, type });
  }

  @Get('calls')
  @UseGuards(RolesGuard)
  @RequireRoles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Every HTTP call made to the providers, newest first' })
  calls(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('providerKey') providerKey?: string,
    @Query('kind') kind?: string,
    @Query('ok') ok?: string,
    @Query('requestId') requestId?: string,
  ) {
    return this.admin.listCalls({ page: Number(page), limit: Number(limit), providerKey, kind, ok, requestId });
  }
}
