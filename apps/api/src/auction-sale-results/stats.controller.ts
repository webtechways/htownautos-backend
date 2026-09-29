import { BadRequestException, Controller, Get, Param, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public, OptionalAuth, TenantOptional, RequirePermissions, RequireApiScopes } from '@htownautos/auth';
import { BREAKDOWN_FIELDS, BreakdownField, StatsService } from './stats.service';
import { QueryStatsDto } from './dto/query-stats.dto';

const STATS_READ_PERMISSION = 'auction-stats:read';
/** API-key scope (Settings → Integrations): server-to-server callers get unmasked data. */
const STATS_READ_SCOPE = 'auction-stats:read';

/**
 * Read/search + facets over auction_sale_results for the dashboard "Stats
 * Listing" AND the public stats.htownautos.com app. Separate controller
 * from the ingest one so the ingest API-key guard doesn't apply here.
 * Marked @Public() to match the global (non-tenant) auction data pattern
 * used by /auctions/search.
 *
 * @OptionalAuth() + @TenantOptional(): a logged-in caller (staff, or the
 * public "customer" role) still gets `request.user` resolved so price data
 * can be shown to them, but the route stays reachable anonymously — see
 * ClerkJwtGuard.tryAttachOptionalUser. @RequirePermissions(STATS_READ_PERMISSION)
 * is read by TenantGuard's customer-role permission check (not by
 * PermissionsGuard — not applied here, this stays public): a "customer"-role
 * caller without the permission gets a 403 PERMISSION_DENIED before reaching
 * this controller at all, so by the time `req.user` is set here, that caller
 * is always authorized to see prices (staff unconditionally, customer only
 * with the permission) — masking below only distinguishes anonymous vs. not.
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
  @OptionalAuth()
  @TenantOptional()
  @RequirePermissions(STATS_READ_PERMISSION)
  @RequireApiScopes(STATS_READ_SCOPE)
  @ApiOperation({ summary: 'Search stored sale results (Stats Listing)' })
  @ApiResponse({ status: 200, description: 'Paginated results + optional aggregations' })
  async search(@Query() dto: QueryStatsDto, @Req() req: any) {
    const result = await this.stats.search(dto);
    if (canSeePrices(req)) return result;
    return { ...result, data: result.data.map(maskFinalBid) };
  }

  @Get('lot/:lot')
  @Public()
  @OptionalAuth()
  @TenantOptional()
  @RequirePermissions(STATS_READ_PERMISSION)
  @RequireApiScopes(STATS_READ_SCOPE)
  @ApiOperation({ summary: 'One stored sale result by lot number' })
  @ApiResponse({ status: 200, description: 'The sale result, or 404' })
  async findByLot(@Param('lot') lot: string, @Req() req: any) {
    const row = await this.stats.findByLot(lot);
    return canSeePrices(req) ? row : maskFinalBid(row);
  }

  /**
   * Todas las corridas de subasta de un VIN + un desenlace derivado por
   * corrida (ver run-outcome.ts). Declarada ANTES de cualquier ruta con
   * parametro que pudiera hacerle sombra.
   */
  @Get('vin/:vin')
  @Public()
  @OptionalAuth()
  @TenantOptional()
  @RequirePermissions(STATS_READ_PERMISSION)
  @RequireApiScopes(STATS_READ_SCOPE)
  @ApiOperation({ summary: 'Every auction run of one VIN, with a derived sale outcome per run' })
  @ApiResponse({ status: 200, description: 'Runs for the VIN + summary' })
  @ApiResponse({ status: 400, description: 'Malformed VIN' })
  async findRunsByVin(@Param('vin') vinParam: string, @Req() req: any) {
    const vin = vinParam.trim().toUpperCase();
    if (!isValidVin(vin)) {
      throw new BadRequestException(`"${vinParam}" is not a valid VIN`);
    }
    const result = await this.stats.findRunsByVin(vin);
    if (canSeePrices(req)) return result;
    return { ...result, runs: result.runs.map(maskRunPrices) };
  }

  @Get('filters')
  @Public()
  @OptionalAuth()
  @TenantOptional()
  @RequirePermissions(STATS_READ_PERMISSION)
  @RequireApiScopes(STATS_READ_SCOPE)
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
  @OptionalAuth()
  @TenantOptional()
  @RequirePermissions(STATS_READ_PERMISSION)
  @RequireApiScopes(STATS_READ_SCOPE)
  @ApiOperation({ summary: 'Price distribution (p25/median/p75) for the current filters' })
  @ApiResponse({ status: 200, description: 'Percentiles + sample size' })
  async priceStats(@Query() dto: QueryStatsDto, @Req() req: any) {
    const result = await this.stats.priceStats(dto);
    if (canSeePrices(req)) return result;
    return { ...result, precio: null, priceHidden: true };
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
  @OptionalAuth()
  @TenantOptional()
  @RequirePermissions(STATS_READ_PERMISSION)
  @RequireApiScopes(STATS_READ_SCOPE)
  @ApiOperation({ summary: 'Group sales by one dimension with count + median price' })
  @ApiQuery({ name: 'por', enum: BREAKDOWN_FIELDS })
  @ApiQuery({ name: 'limite', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Groups with sample size and median price' })
  async breakdown(
    @Query() dto: QueryStatsDto,
    @Query('por') por: string,
    @Query('limite') limite: string | undefined,
    @Req() req: any,
  ) {
    if (!BREAKDOWN_FIELDS.includes(por as BreakdownField)) {
      throw new BadRequestException(
        `"por" debe ser uno de: ${BREAKDOWN_FIELDS.join(', ')}`,
      );
    }
    const n = Number(limite);
    const groups = await this.stats.breakdown(
      dto,
      por as BreakdownField,
      Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), 100) : 25,
    );
    if (canSeePrices(req)) return groups;
    return groups.map((g) => ({ ...g, medianaPrecio: null, priceHidden: true }));
  }
}

/**
 * By the time a controller method runs, TenantGuard has already gated any
 * "customer"-role caller lacking STATS_READ_PERMISSION with a 403 — so a
 * present `req.user` here always means "authorized to see prices" (staff
 * unconditionally, customer only with the permission). An API key reaching
 * here already passed @RequireApiScopes(STATS_READ_SCOPE) in ApiKeyGuard.
 * No user = anonymous.
 */
function canSeePrices(req: any): boolean {
  return !!req.user;
}

/**
 * Hides every field that carries the sale price, not just finalBid: ~21% of
 * rows (the non-live ingest) also hold it in highBidAtSync, and askingPrice
 * sits right next to it — returning those leaked the price to anonymous callers.
 */
function maskFinalBid(row: any): any {
  return { ...row, finalBid: null, highBidAtSync: null, askingPrice: null, priceHidden: true };
}

// Excludes I, O, Q (never used in real VINs) per the standard VIN charset.
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

function isValidVin(vin: string): boolean {
  if (!VIN_RE.test(vin)) return false;
  if (new Set(vin).size === 1) return false; // all one repeated char
  if (vin.startsWith('0000000')) return false;
  return true;
}

/**
 * Masks every run of a VIN's run-outcome response. `price` is derived from
 * `finalBid`/`highBidAtSync` in the service, so it has to be nulled here too
 * — otherwise it would leak the exact figure the other two fields hide.
 */
function maskRunPrices(row: any): any {
  return { ...row, finalBid: null, highBidAtSync: null, askingPrice: null, price: null, priceHidden: true };
}
