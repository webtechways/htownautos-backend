import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ADMIN_ROLES, RequireApiScopes, RequireRoles, RolesGuard } from '@htownautos/auth';
import { VehicleHistoryService } from './vehicle-history.service';
import { VehicleHistoryAdminService } from './vehicle-history-admin.service';
import { VehicleHistoryLibraryService } from './vehicle-history-library.service';
import { VehicleHistoryExtractionService } from './vehicle-history-extraction.service';
import {
  ExtractionLogsQueryDto,
  LibraryQueryDto,
  OrderReportDto,
  ReorderProvidersDto,
  ReprocessBulkDto,
  TestProviderDto,
  UpdateProviderDto,
  UpdateSettingsDto,
} from './dto';
import { REPORT_TYPES, ReportType } from './types';
import { isAllowedCallbackUrl } from './vehicle-history-webhooks.service';

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
    private readonly reportsLibrary: VehicleHistoryLibraryService,
    private readonly extractions: VehicleHistoryExtractionService,
  ) {}

  // ── Ordering ────────────────────────────────────────────────────────────

  @Post('reports')
  @RequireApiScopes('vehicle-history:write')
  @ApiOperation({
    summary: 'Order a Carfax or AutoCheck report by VIN',
    description:
      'Served from the cache when a report for the VIN + type is recent enough (settings.cacheDays); otherwise the providers are tried in priority order until one delivers. Waits up to `wait` seconds (default 25); a request still running comes back with status "running" (or "delayed": a provider is finishing a paid job in the background) — poll GET /vehicle-history/requests/:id, or pass callbackUrl to be notified.',
  })
  order(@Body() dto: OrderReportDto, @Req() req: AuthedRequest) {
    if (dto.callbackUrl && (!req.apiKey || !isAllowedCallbackUrl(dto.callbackUrl))) {
      throw new BadRequestException('callbackUrl must be a public https URL, and is only for API keys');
    }
    return this.history.order(
      {
        vin: dto.vin,
        type: dto.type,
        force: dto.force,
        source: req.apiKey ? 'api' : 'crm',
        requestedBy: req.apiKey ? `api-key:${req.apiKey.id}` : req.user?.id ?? null,
        tenantId: req.tenant?.id ?? null,
        callbackUrl: dto.callbackUrl ?? null,
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

  @Get('parsed/:vin')
  @RequireApiScopes('vehicle-history:read')
  @ApiOperation({ summary: 'Structured parse of stored reports for a VIN, newest first' })
  parsed(@Param('vin') vin: string) {
    return this.history.parsedForVin(vin);
  }

  @Get('extraction/:vin')
  @RequireApiScopes('vehicle-history:read')
  @ApiOperation({ summary: 'Latest OpenAI structured-output extraction (v2) for a VIN' })
  async extractionForVin(@Param('vin') vin: string) {
    const result = await this.extractions.getExtractionForVin(vin);
    if (!result) throw new NotFoundException('No extraction for this VIN');
    return result;
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

  // ── Reports library (Carfax/AutoCheck, both source tables) ───────────────

  @Get('library')
  @UseGuards(RolesGuard)
  @RequireRoles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Unified list of stored reports (carfax_reports + vehicle_history_reports) with their parse, newest first' })
  library(@Query() query: LibraryQueryDto) {
    return this.reportsLibrary.list(query);
  }

  @Get('library/:source/:id')
  @UseGuards(RolesGuard)
  @RequireRoles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'One report with its full structured parse and order history' })
  libraryOne(@Param('source') source: string, @Param('id') id: string) {
    return this.reportsLibrary.getOne(source, id);
  }

  @Get('library/:source/:id/file')
  @UseGuards(RolesGuard)
  @RequireRoles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Short-lived signed URL to the original report file' })
  libraryFile(@Param('source') source: string, @Param('id') id: string) {
    return this.reportsLibrary.getFile(source, id);
  }

  @Post('library/:source/:id/reprocess')
  @HttpCode(202)
  @UseGuards(RolesGuard)
  @RequireRoles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Re-queue the OpenAI extraction for this report (forces a re-run even if already ok at the current prompt version)' })
  reprocessOne(@Param('source') source: string, @Param('id') id: string, @Req() req: AuthedRequest) {
    return this.extractions.reprocessOne(source, id, req.user?.id ?? null);
  }

  // ── Extraction (OpenAI structured output, v2) ────────────────────────────

  @Get('extraction-logs')
  @UseGuards(RolesGuard)
  @RequireRoles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Extraction attempt log with filters, pagination and spend totals (today/month/all-time in America/Chicago)' })
  extractionLogs(@Query() query: ExtractionLogsQueryDto) {
    return this.extractions.listLogs(query);
  }

  @Post('extractions/reprocess-bulk')
  @HttpCode(202)
  @UseGuards(RolesGuard)
  @RequireRoles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Re-queue extraction for many reports at once (failed | outdated prompt version | all)' })
  reprocessBulk(@Body() body: ReprocessBulkDto, @Req() req: AuthedRequest) {
    return this.extractions.reprocessBulk(body, req.user?.id ?? null);
  }
}
