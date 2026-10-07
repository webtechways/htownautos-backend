import { Controller, ForbiddenException, Get, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OptionalAuth, Public, RequireApiScopes, RequirePermissions, TenantOptional } from '@htownautos/auth';
import { MarketAnalyticsService } from './market-analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';

/** Los mismos permisos que /auction-sale-results: es el mismo dato, agregado. */
const STATS_READ = 'auction-stats:read';

/**
 * Series agregadas para las graficas de PrecioTope (/graph).
 *
 * Mismo esquema de acceso que StatsController, pero aqui no hay version
 * enmascarada: una mediana de precio ES el dato de pago, asi que sin usuario
 * (staff, cliente con permiso o API key con el scope) no se contesta. El
 * reparto por plan lo hace PrecioTope, que es quien sabe el plan del usuario.
 */
@ApiTags('Market Analytics')
@Controller('market-analytics')
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class MarketAnalyticsController {
  constructor(private readonly analytics: MarketAnalyticsService) {}

  @Get('trend')
  @Public() @OptionalAuth() @TenantOptional()
  @RequirePermissions(STATS_READ) @RequireApiScopes(STATS_READ)
  @ApiOperation({ summary: 'Median + p25/p75 final bid and volume per day/week/month' })
  trend(@Query() dto: AnalyticsQueryDto, @Req() req: any) {
    autorizado(req);
    return this.analytics.trend(dto);
  }

  @Get('distribution')
  @Public() @OptionalAuth() @TenantOptional()
  @RequirePermissions(STATS_READ) @RequireApiScopes(STATS_READ)
  @ApiOperation({ summary: 'Final bid histogram (tail above p97 folded into the last bin)' })
  distribution(@Query() dto: AnalyticsQueryDto, @Req() req: any) {
    autorizado(req);
    return this.analytics.distribution(dto);
  }

  @Get('kpis')
  @Public() @OptionalAuth() @TenantOptional()
  @RequirePermissions(STATS_READ) @RequireApiScopes(STATS_READ)
  @ApiOperation({ summary: 'Headline numbers: last N days vs the N before, plus a 12-week sparkline' })
  kpis(@Query() dto: AnalyticsQueryDto, @Req() req: any) {
    autorizado(req);
    return this.analytics.kpis(dto);
  }
}

function autorizado(req: any) {
  if (!req.user) throw new ForbiddenException({ code: 'auth_required', message: 'Market analytics need an authorized caller' });
}
