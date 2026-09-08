import { Controller, Get, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@htownautos/auth';
import { StatsService } from './stats.service';
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
}
