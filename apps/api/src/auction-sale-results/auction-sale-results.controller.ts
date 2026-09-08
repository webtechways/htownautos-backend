import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Public } from '@htownautos/auth';
import { AuctionIngestGuard } from './auction-ingest.guard';
import { AuctionSaleResultsService } from './auction-sale-results.service';
import { AuctionFramesService } from './auction-frames.service';
import { IngestFramesDto } from './dto/ingest-frames.dto';
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
   */
  @Post('ingest/frames')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Queue raw live-auction frames (Solace) for decoding' })
  @ApiResponse({ status: 200, description: 'How many arrived and how many were queued' })
  ingestFrames(@Body() dto: IngestFramesDto) {
    return this.frames.ingest(dto);
  }
}
