import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@htownautos/auth';
import { BREAKDOWN_FIELDS, BreakdownField, StatsService } from './stats.service';
import { QueryStatsDto } from './dto/query-stats.dto';

/**
 * Read/search + facets over auction_sale_results for the dashboard "Stats
 * Listing". Separate controller from the ingest one so the ingest API-key
 * guard doesn't apply here. Marked @Public() to match the global (non-tenant)
 * auction data pattern used by /auctions/search.
 *
 * Tope propio: la rejilla de Stats pide 24 galerias por pagina, asi que va
 * holgado — corta el raspado masivo sin estorbar al uso normal.
 */
@ApiTags('Auction Sale Results')
@Controller('auction-sale-results')
@Throttle({ default: { limit: 300, ttl: 60_000 } })
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Search stored sale results (Stats Listing)' })
  @ApiResponse({ status: 200, description: 'Paginated results + optional aggregations' })
  search(@Query() dto: QueryStatsDto) {
    return this.stats.search(dto);
  }

  @Get('lot/:lot')
  @Public()
  @ApiOperation({ summary: 'One stored sale result by lot number' })
  @ApiResponse({ status: 200, description: 'The sale result, or 404' })
  findByLot(@Param('lot') lot: string) {
    return this.stats.findByLot(lot);
  }

  @Get('filters')
  @Public()
  @ApiOperation({ summary: 'Facet counts for the Stats Listing sidebar' })
  @ApiResponse({ status: 200, description: 'Aggregations' })
  getFilters(@Query() dto: QueryStatsDto) {
    return this.stats.getFilters(dto);
  }

  /**
   * Distribucion de `finalBid` para los filtros dados: p25 / mediana / p75 y los
   * extremos. Ya existia en StatsService para el chat de IA; la pagina de
   * Reportes consume el MISMO metodo a proposito, para que chat y pantalla no
   * puedan discrepar sobre lo que significa un filtro.
   */
  @Get('price-stats')
  @Public()
  @ApiOperation({ summary: 'Price distribution (p25/median/p75) for the current filters' })
  @ApiResponse({ status: 200, description: 'Percentiles + sample size' })
  priceStats(@Query() dto: QueryStatsDto) {
    return this.stats.priceStats(dto);
  }

  /**
   * Agrupacion por una dimension (el "group by" de la pagina de Reportes).
   *
   * `por` se valida contra la lista blanca aqui y no en el servicio: el nombre
   * de columna acaba interpolado en SQL crudo, y aunque un valor desconocido
   * solo produciria un identificador inexistente (no inyeccion), devolveria un
   * 500 en vez de decirle al cliente que el campo no existe.
   */
  @Get('breakdown')
  @Public()
  @ApiOperation({ summary: 'Group sales by one dimension with count + median price' })
  @ApiQuery({ name: 'por', enum: BREAKDOWN_FIELDS })
  @ApiQuery({ name: 'limite', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Groups with sample size and median price' })
  breakdown(
    @Query() dto: QueryStatsDto,
    @Query('por') por: string,
    @Query('limite') limite?: string,
  ) {
    if (!BREAKDOWN_FIELDS.includes(por as BreakdownField)) {
      throw new BadRequestException(
        `"por" debe ser uno de: ${BREAKDOWN_FIELDS.join(', ')}`,
      );
    }
    const n = Number(limite);
    return this.stats.breakdown(
      dto,
      por as BreakdownField,
      Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), 100) : 25,
    );
  }
}
