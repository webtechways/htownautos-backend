import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Public } from '@htownautos/auth';
import { AuctionIngestGuard } from './auction-ingest.guard';
import { AuctionSaleResultsService } from './auction-sale-results.service';
import { AuctionFramesService } from './auction-frames.service';
import { IngestFramesDto } from './dto/ingest-frames.dto';
import { IngestLogsDto } from './dto/ingest-logs.dto';
import { ExtensionLogsService } from './extension-logs.service';
import { BroadcastRoomsService } from './broadcast-rooms.service';
import type { SaleResultItemDto } from './dto/ingest-sale-results.dto';

/**
 * External ingestion for post-sale auction outcomes. `@Public()` bypasses the
 * global Clerk/Tenant chain; the shared-secret AuctionIngestGuard authorizes.
 *
 * Payload-tolerant: accepts a bare array `[ …items ]` (what the n8n webhook
 * sends), an envelope `{ body: [ …items ] }`, or a single item object. Items
 * are best-effort — the service validates/coerces per item and skips bad ones.
 */
@ApiTags('Auction Sale Results')
@ApiSecurity('x-api-key')
@Controller('auction-sale-results')
@Public()
@UseGuards(AuctionIngestGuard)
export class AuctionSaleResultsController {
  constructor(
    private readonly service: AuctionSaleResultsService,
    private readonly frames: AuctionFramesService,
    private readonly extLogs: ExtensionLogsService,
    private readonly broadcastRooms: BroadcastRoomsService,
  ) {}

  @Post('ingest')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ingest scraped post-sale auction results',
    description:
      'Accepts a bare array [ …items ], { body: [ …items ] }, or a single item. ' +
      'For each item, looks up the vehicle in auction_listings by lot number and ' +
      'stores a merged row (incoming sale data + frozen vehicle snapshot), ' +
      'upserted on (lot, saleDate).',
  })
  @ApiResponse({ status: 200, description: 'Ingest summary' })
  async ingest(@Body() payload: unknown) {
    const items = this.normalize(payload);
    return this.service.ingest(items);
  }

  /** Coerce any accepted payload shape into an items array. */
  private normalize(payload: unknown): SaleResultItemDto[] {
    if (Array.isArray(payload)) return payload as SaleResultItemDto[];
    if (payload && typeof payload === 'object') {
      const body = (payload as any).body;
      if (Array.isArray(body)) return body as SaleResultItemDto[];
      // A single item object with a lot → wrap it.
      if ('lot' in (payload as any)) return [payload as SaleResultItemDto];
    }
    return [];
  }

  /**
   * Frames crudos de la subasta en vivo, uno o en lote.
   *
   * Ruta aparte de /ingest y no el mismo cuerpo: /ingest ya tiene una forma
   * concreta que usa la extension actual, y aceptar dos formas distintas en la
   * misma ruta deja la validacion ambigua y rompe lo que ya funciona el dia
   * que una se parezca a la otra.
   *
   * Aqui no se decodifica: se guarda el crudo y se encola. La respuesta es
   * inmediata pase lo que pase con el parser.
   *
   * Las dos fuentes de la extension (`source`: sala o difusion) entran por
   * aqui; el consumidor elige el decodificador segun la fila.
   */
  @Post('ingest/frames')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Queue live-auction frames for decoding: Solace room frames (source=room, default) or AutoBidMaster broadcast messages (source=broadcast)' })
  @ApiResponse({ status: 200, description: 'How many arrived and how many were queued' })
  ingestFrames(@Body() dto: IngestFramesDto) {
    return this.frames.ingest(dto);
  }

  /**
   * Log de lo que hace la extension por detras (planificador, pasadas,
   * errores del worker). Llega en lotes, uno por VM y minuto.
   */
  @Post('ingest/logs')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Store a batch of log entries from the VM browser extension' })
  ingestLogs(@Body() dto: IngestLogsDto) {
    return this.extLogs.ingest(dto);
  }

  /**
   * Salas en vivo para el modo Broadcast de la extension: las que empiezan en
   * los proximos `leadMinutes` (15 por defecto) o ya empezaron hoy. La
   * extension la pide cada pocos minutos y se suscribe a las nuevas.
   */
  @Get('broadcast/live-rooms')
  @ApiOperation({
    summary: 'Broadcast-socket room codes that are live or start within leadMinutes (auction=copart|iaai|all; default copart)',
  })
  liveRooms(@Query('leadMinutes') leadMinutes?: string, @Query('auction') auction?: string) {
    const n = Number(leadMinutes);
    // Sin `auction` = copart: la extension actual no lo manda y debe seguir igual.
    const a = auction === 'iaai' || auction === 'all' ? auction : 'copart';
    return this.broadcastRooms.live(
      Number.isFinite(n) && leadMinutes !== undefined && leadMinutes !== '' ? n : undefined,
      a,
    );
  }
}
