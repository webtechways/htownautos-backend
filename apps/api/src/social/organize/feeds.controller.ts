import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, RequireApiScopes } from '@htownautos/auth';
import { CreateFeedDto, FeedItemsQueryDto } from './dto';
import { SocialFeedsService } from './feeds.service';

@ApiTags('social-feeds')
@Controller('social/feeds')
export class SocialFeedsController {
  constructor(private readonly feedsService: SocialFeedsService) {}

  @Get()
  @RequireApiScopes('social:read')
  @ApiOperation({ summary: 'List feeds followed by the tenant' })
  list(@CurrentTenant() tenantId: string) {
    return this.feedsService.list(tenantId);
  }

  @Get('items')
  @RequireApiScopes('social:read')
  @ApiOperation({ summary: 'Paginated feed items, optionally filtered by feedId' })
  listItems(@CurrentTenant() tenantId: string, @Query() query: FeedItemsQueryDto) {
    return this.feedsService.listItems(tenantId, query);
  }

  @Post()
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Add a feed — validates it is a reachable, SSRF-safe RSS/Atom URL before saving' })
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateFeedDto) {
    return this.feedsService.create(tenantId, dto);
  }

  @Patch(':id')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Change a feed\'s URL — re-validates before saving' })
  update(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateFeedDto) {
    return this.feedsService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Remove a feed' })
  remove(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.feedsService.remove(tenantId, id);
  }

  @Post(':id/refresh')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Refresh a feed now — failures are recorded in lastError, never thrown' })
  refresh(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.feedsService.refresh(tenantId, id);
  }
}
