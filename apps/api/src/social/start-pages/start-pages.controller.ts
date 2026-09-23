import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, RequireApiScopes } from '@htownautos/auth';
import { StartPageInputDto, StartPageStatsQueryDto } from './dto';
import { SocialStartPagesService } from './start-pages.service';

@ApiTags('social-start-pages')
@Controller('social/start-pages')
export class SocialStartPagesController {
  constructor(private readonly startPagesService: SocialStartPagesService) {}

  @Get()
  @RequireApiScopes('social:read')
  @ApiOperation({ summary: 'List the tenant\'s start pages' })
  list(@CurrentTenant() tenantId: string) {
    return this.startPagesService.list(tenantId);
  }

  @Post()
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Create a start page' })
  create(@CurrentTenant() tenantId: string, @Body() dto: StartPageInputDto) {
    return this.startPagesService.create(tenantId, dto);
  }

  @Get(':id')
  @RequireApiScopes('social:read')
  @ApiOperation({ summary: 'Get one start page' })
  get(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.startPagesService.get(tenantId, id);
  }

  @Patch(':id')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Update a start page' })
  update(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StartPageInputDto) {
    return this.startPagesService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Delete a start page' })
  remove(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.startPagesService.remove(tenantId, id);
  }

  @Post(':id/publish')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Publish a start page' })
  publish(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.startPagesService.publish(tenantId, id);
  }

  @Post(':id/unpublish')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Unpublish a start page' })
  unpublish(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.startPagesService.unpublish(tenantId, id);
  }

  @Get(':id/stats')
  @RequireApiScopes('social:read')
  @ApiOperation({ summary: 'Views/clicks/ctr, daily series and per-block breakdown for a date range' })
  stats(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Query() query: StartPageStatsQueryDto) {
    return this.startPagesService.stats(tenantId, id, query);
  }
}
