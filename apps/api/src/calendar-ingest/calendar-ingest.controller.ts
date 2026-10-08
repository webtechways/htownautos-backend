import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@htownautos/auth';
import { AuctionIngestGuard } from '../auction-sale-results/auction-ingest.guard';
import { AuctionCalendarService } from '../auction-calendar/auction-calendar.service';
import { IaaiCalendarService } from '../iaai-calendar/iaai-calendar.service';
import { IngestCalendarsDto } from './calendar-ingest.dto';

/**
 * Los calendarios de Copart (AutoBidMaster) e IAAI que lee la extension de
 * calendarios desde un Chrome de verdad: el servidor y los proxies estan
 * bloqueados por Cloudflare/Imperva. Cada calendario se procesa con la misma
 * logica que el scraper del servidor y cada envio —bueno o fallido— queda en
 * el log de sincronizacion de su calendario.
 */
@ApiTags('Auction calendar')
@Controller('auction-sale-results')
@Public()
@UseGuards(AuctionIngestGuard)
export class CalendarIngestController {
  constructor(
    private readonly copart: AuctionCalendarService,
    private readonly iaai: IaaiCalendarService,
  ) {}

  @Post('ingest/calendars')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Copart and/or IAAI calendar read by the calendar extension' })
  async ingest(@Body() dto: IngestCalendarsDto) {
    const resultado = async (fn: () => Promise<{ count: number; skipped?: boolean }>) => {
      try {
        const r = await fn();
        return r.skipped ? { ok: false, error: 'ya habia una sync en curso' } : { ok: true, count: r.count };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    };
    const [copart, iaai] = await Promise.all([
      dto.copart ? resultado(() => this.copart.ingestFromExtension({ worker: dto.worker, ...dto.copart! })) : null,
      dto.iaai ? resultado(() => this.iaai.ingestFromExtension({ worker: dto.worker, ...dto.iaai! })) : null,
    ]);
    return { copart, iaai };
  }
}
