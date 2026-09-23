import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, CurrentUser, RequireApiScopes, type AuthenticatedUser } from '@htownautos/auth';
import { BestTimesQueryDto, InsightsExportQueryDto, InsightsQueryDto, PostInsightsQueryDto, SyncInsightsDto } from './dto';
import { SocialInsightsService } from './insights.service';

@ApiTags('social-insights')
@Controller('social/insights')
export class SocialInsightsController {
  constructor(private readonly insightsService: SocialInsightsService) {}

  @Get('overview')
  @RequireApiScopes('social:read')
  @ApiOperation({ summary: 'Totals, daily series and per-account breakdown for a date range' })
  overview(@CurrentTenant() tenantId: string, @Query() query: InsightsQueryDto) {
    return this.insightsService.overview(tenantId, query);
  }

  @Get('posts')
  @RequireApiScopes('social:read')
  @ApiOperation({ summary: 'Paginated per-post metrics, sortable by date/impressions/engagements/engagementRate' })
  posts(@CurrentTenant() tenantId: string, @Query() query: PostInsightsQueryDto) {
    return this.insightsService.posts(tenantId, query);
  }

  @Get('best-times')
  @RequireApiScopes('social:read')
  @ApiOperation({ summary: '7×24 heatmap of best times to post for one account' })
  bestTimes(@CurrentTenant() tenantId: string, @Query() query: BestTimesQueryDto) {
    return this.insightsService.bestTimes(tenantId, query.accountId);
  }

  @Get('export')
  @RequireApiScopes('social:read')
  @ApiOperation({ summary: 'CSV export of per-post metrics for a date range' })
  async export(@CurrentTenant() tenantId: string, @Query() query: InsightsExportQueryDto, @Res() res: Response) {
    const csv = await this.insightsService.exportCsv(tenantId, query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="social-insights-${query.from}_${query.to}.csv"`);
    res.send(csv);
  }

  @Post('sync')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Admin: trigger an immediate account metrics snapshot' })
  sync(@CurrentTenant() tenantId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: SyncInsightsDto) {
    return this.insightsService.sync(tenantId, user, dto);
  }
}
