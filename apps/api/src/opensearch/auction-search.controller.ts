import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { AuctionSearchService } from './auction-search.service';
import { AuctionSyncService, AuctionIndexService } from '@htownautos/opensearch';
import {
  RabbitMQService,
  AUCTION_SYNC_TRIGGER_QUEUE,
  type AuctionSyncTriggerMessage,
} from '@htownautos/rabbitmq';
import { SearchAuctionsDto } from './dto/search-auctions.dto';
import { DiscardAuctionDto } from './dto/discard-auction.dto';
import { UpsertAnalysisSnapshotDto } from './dto/upsert-analysis-snapshot.dto';
import { ClerkJwtGuard, CurrentUser, Public } from '@htownautos/auth';
import { PrismaService } from '@htownautos/prisma';

/**
 * Heavy sync work (CSV import, full reindex, index recreation) is owned by the
 * `data-sync` worker. This api only publishes a trigger message to RabbitMQ so
 * the user gets an immediate response and the api process never blocks on a
 * minutes-long pipeline.
 *
 * Read-only endpoints (`/sync/stats`, `/index/stats`) stay here because they
 * are cheap.
 */
@ApiTags('Auctions (OpenSearch)')
/**
 * Tope propio: cada busqueda es una consulta a OpenSearch con agregaciones, y
 * la galeria sale a Copart por proxy. 300/min deja de sobra para navegar —una
 * rejilla carga 24 fichas— y corta el raspado masivo.
 */
@Controller('auctions')
@Throttle({ default: { limit: 300, ttl: 60_000 } })
export class AuctionSearchController {
  constructor(
    private readonly searchService: AuctionSearchService,
    private readonly syncService: AuctionSyncService,
    private readonly indexService: AuctionIndexService,
    private readonly rabbitMQ: RabbitMQService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('search')
  @Public()
  @ApiOperation({
    summary: 'Search auctions from all sources',
    description: 'Unified search across Copart and MarketCheck auction listings with filters and aggregations',
  })
  @ApiResponse({ status: 200, description: 'Search results with pagination and optional aggregations' })
  async search(@Query() dto: SearchAuctionsDto) {
    return this.searchService.search(dto);
  }

  @Get('filters')
  @Public()
  @ApiOperation({
    summary: 'Get available filter options',
    description: 'Returns distinct values for all filterable fields. Supports cascading filters - pass make to filter models, pass make+model to filter trims.',
  })
  @ApiResponse({ status: 200, description: 'Filter options (aggregations)' })
  async getFilterOptions(@Query() dto: SearchAuctionsDto) {
    return this.searchService.getFilterOptions(dto);
  }

  @Get('get-gallery/copart/:id')
  @Public()
  @ApiOperation({
    summary: 'Get gallery images for a Copart listing',
    description: 'Fetches images from Copart API and returns thumbnail and high-res URLs for gallery display',
  })
  @ApiParam({ name: 'id', description: 'Auction listing ID (UUID)' })
  @ApiResponse({ status: 200, description: 'Gallery images with thumbnail and full-size URLs' })
  @ApiResponse({ status: 404, description: 'Auction listing not found' })
  async getCopartGallery(@Param('id') id: string, @Query('bypass') bypass?: string) {
    if (bypass === 'true') {
      return this.searchService.getCopartGalleryRaw(id);
    }
    return this.searchService.getCopartGallery(id);
  }

  @Get('last-sync')
  @Public()
  @ApiOperation({ summary: 'Get last Copart sync timestamp' })
  @ApiResponse({ status: 200, description: 'Last sync info' })
  async getLastSync() {
    return this.searchService.getLastSyncTime();
  }

  // === SYNC TRIGGERS — published to RabbitMQ, executed by data-sync ===

  @Post('import/copart')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Queue full Copart import (CSV → DB → OpenSearch)',
    description: 'Publishes a trigger to the data-sync worker. Returns immediately; check sync stats to follow progress.',
  })
  @ApiResponse({ status: 202, description: 'Sync queued' })
  async importCopart() {
    return this.publishSync({ kind: 'copart-import' });
  }

  @Post('import/recreate')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Queue index recreate + full Copart import',
    description: 'Publishes a destructive trigger: drop the OpenSearch index, then re-import everything from Copart.',
  })
  @ApiResponse({ status: 202, description: 'Recreate + import queued' })
  async recreateAndImport() {
    return this.publishSync({ kind: 'copart-import-recreate' });
  }

  @Post('sync/all')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Queue reindex of all sources to OpenSearch',
  })
  @ApiResponse({ status: 202, description: 'Reindex queued' })
  async syncAll() {
    return this.publishSync({ kind: 'reindex-all' });
  }

  @Post('sync/copart')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Queue reindex of all Copart listings to OpenSearch',
  })
  @ApiResponse({ status: 202, description: 'Reindex queued' })
  async syncCopart() {
    return this.publishSync({ kind: 'reindex-copart' });
  }

  @Get('sync/stats')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get sync statistics',
    description: 'Returns counts of listings in PostgreSQL and OpenSearch',
  })
  @ApiResponse({ status: 200, description: 'Sync statistics' })
  async getSyncStats() {
    return this.syncService.getSyncStats();
  }

  /**
   * GET /auctions/sync/status
   *
   * Returns the most recent SyncRun for source='copart'. If a run is actively
   * in status='running', that row is always preferred over a completed one.
   * Poll this endpoint from the dashboard to show live sync progress.
   *
   * Auth: no explicit @UseGuards — the global ClerkJwtGuard applied in AppModule
   * covers all routes that aren't decorated with @Public(). Staff-only by default.
   */
  @Get('sync/status')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get live sync status for the Copart feed',
    description:
      'Returns the active (running) SyncRun if one exists, otherwise the most recent one. ' +
      'Fields: status, phase, progress (0-100), processedRows, totalRows, startedAt, finishedAt, ' +
      'durationMs, bytesDownloaded, rowsParsed, rowsUpserted, rowsStaleMarked.',
  })
  @ApiResponse({ status: 200, description: 'Current or last Copart sync status' })
  async getSyncStatus() {
    // A sync never legitimately runs longer than this; anything older that is
    // still flagged "running" is an orphaned row from a worker that died/hung
    // mid-run, so we must NOT show it as live progress (it would stick at 0%).
    const STALE_RUNNING_MS = 2 * 60 * 60 * 1000;
    const freshCutoff = new Date(Date.now() - STALE_RUNNING_MS);

    // Prefer a genuinely-active (recent) running row so the UI sees live progress.
    const running = await this.prisma.syncRun.findFirst({
      where: {
        source: 'copart',
        status: 'running',
        startedAt: { gte: freshCutoff },
      },
      orderBy: { startedAt: 'desc' },
      select: {
        status: true,
        phase: true,
        progress: true,
        processedRows: true,
        totalRows: true,
        startedAt: true,
        finishedAt: true,
        durationMs: true,
        source: true,
        bytesDownloaded: true,
        rowsParsed: true,
        rowsUpserted: true,
        rowsStaleMarked: true,
      },
    });

    if (running) return running;

    // No active run — return the most recent completed/failed row.
    const latest = await this.prisma.syncRun.findFirst({
      where: { source: 'copart' },
      orderBy: { startedAt: 'desc' },
      select: {
        status: true,
        phase: true,
        progress: true,
        processedRows: true,
        totalRows: true,
        startedAt: true,
        finishedAt: true,
        durationMs: true,
        source: true,
        bytesDownloaded: true,
        rowsParsed: true,
        rowsUpserted: true,
        rowsStaleMarked: true,
      },
    });

    if (!latest) return { status: 'idle', progress: 0 };

    // If the most recent row is itself a stale orphaned "running" (worker died
    // mid-run), surface it as failed so the dashboard stops showing "Syncing…".
    if (latest.status === 'running' && latest.startedAt < freshCutoff) {
      return { ...latest, status: 'failed', phase: latest.phase ?? 'stalled' };
    }

    return latest;
  }

  @Get('index/stats')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get index statistics',
    description: 'Returns OpenSearch index statistics (document count, size)',
  })
  @ApiResponse({ status: 200, description: 'Index statistics' })
  async getIndexStats() {
    return this.indexService.getIndexStats();
  }

  @Post('index/recreate')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Queue OpenSearch index recreate',
    description: 'Publishes a destructive trigger: drop and recreate the index. No reimport.',
  })
  @ApiResponse({ status: 202, description: 'Recreate queued' })
  async recreateIndex() {
    return this.publishSync({ kind: 'recreate-index' });
  }

  @Post('copart/:lotNumber/refresh-bid')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh current high bid for a Copart lot',
    description:
      'Scrapes autobidmaster.com for the given lot number, extracts the qa_current_bid value, persists it to the auction listing, and reindexes the doc.',
  })
  @ApiParam({ name: 'lotNumber', description: 'Copart lot number' })
  @ApiResponse({ status: 200, description: 'Refreshed high bid' })
  @ApiResponse({ status: 404, description: 'Auction listing not found' })
  async refreshCopartBid(@Param('lotNumber') lotNumber: string) {
    return this.searchService.refreshHighBid(lotNumber);
  }

  @Patch(':source/:sourceId/discard')
  @UseGuards(ClerkJwtGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set or clear the discarded state for an auction listing',
    description: 'Staff-only. Marks a lot as discarded (with optional reason) or clears the flag. Only copart lots are persisted in Postgres; IAAI lots return 404.',
  })
  @ApiParam({ name: 'source', enum: ['copart', 'iaai'] })
  @ApiParam({ name: 'sourceId', description: 'Lot number (Copart)' })
  @ApiResponse({ status: 200, description: 'Updated discard state' })
  @ApiResponse({ status: 404, description: 'Auction listing not found' })
  async discardAuction(
    @Param('source') source: 'copart' | 'iaai',
    @Param('sourceId') sourceId: string,
    @Body() dto: DiscardAuctionDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.searchService.discardListing(sourceId, dto.discarded, dto.reason, userId ?? null);
  }

  @Put(':source/:sourceId/analysis-snapshot')
  @UseGuards(ClerkJwtGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Upsert an analysis snapshot for an auction listing',
    description: 'Staff-only. Persists a staff-generated live analysis (MarketCheck / Comparables / Auction History) so read-only views can show it without re-calling paid external APIs.',
  })
  @ApiParam({ name: 'source', enum: ['copart', 'iaai'] })
  @ApiParam({ name: 'sourceId', description: 'Lot number (numeric)' })
  @ApiResponse({ status: 200, description: 'Snapshot upserted' })
  @ApiResponse({ status: 400, description: 'sourceId is not numeric' })
  async upsertAnalysisSnapshot(
    @Param('sourceId') sourceId: string,
    @Body() dto: UpsertAnalysisSnapshotDto,
  ) {
    return this.searchService.upsertAnalysisSnapshot(sourceId, dto.type, dto.data);
  }

  @Get(':source/:sourceId/analysis-snapshot')
  @UseGuards(ClerkJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get persisted analysis snapshots for an auction listing',
    description: 'Staff-only. Returns previously-saved analysis snapshots keyed by type so the auction detail view can restore them on reload.',
  })
  @ApiParam({ name: 'source', enum: ['copart', 'iaai'] })
  @ApiParam({ name: 'sourceId', description: 'Lot number (numeric)' })
  async getAnalysisSnapshots(@Param('sourceId') sourceId: string) {
    return this.searchService.getAnalysisSnapshots(sourceId);
  }

  // Wildcard route — MUST be last to avoid catching static routes
  @Get(':source/:sourceId')
  @Public()
  @ApiOperation({
    summary: 'Get a single auction by source and ID',
    description: 'Retrieve an auction by its source (copart/iaai) and source ID (lotNumber/externalId)',
  })
  @ApiParam({ name: 'source', enum: ['copart', 'iaai'] })
  @ApiParam({ name: 'sourceId', description: 'Lot number (Copart) or External ID (IAAI)' })
  @ApiResponse({ status: 200, description: 'Auction details' })
  @ApiResponse({ status: 404, description: 'Auction not found' })
  async findBySourceId(
    @Param('source') source: 'copart' | 'iaai',
    @Param('sourceId') sourceId: string,
  ) {
    const result = await this.searchService.findBySourceId(source, sourceId);
    if (!result) {
      return { error: 'Auction not found', source, sourceId };
    }
    return result;
  }

  private async publishSync(
    msg: AuctionSyncTriggerMessage,
  ): Promise<{ queued: boolean; kind: string }> {
    const queued = await this.rabbitMQ.publish(AUCTION_SYNC_TRIGGER_QUEUE, msg);
    return { queued, kind: msg.kind };
  }
}
