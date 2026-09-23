import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, RequireApiScopes } from '@htownautos/auth';
import { CreateHashtagGroupDto, UpdateHashtagGroupDto } from './dto';
import { SocialHashtagGroupsService } from './hashtag-groups.service';

@ApiTags('social-hashtag-groups')
@Controller('social/hashtag-groups')
export class SocialHashtagGroupsController {
  constructor(private readonly hashtagGroupsService: SocialHashtagGroupsService) {}

  @Get()
  @RequireApiScopes('social:read')
  @ApiOperation({ summary: 'List hashtag groups for the tenant' })
  list(@CurrentTenant() tenantId: string) {
    return this.hashtagGroupsService.list(tenantId);
  }

  @Post()
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Create a hashtag group' })
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateHashtagGroupDto) {
    return this.hashtagGroupsService.create(tenantId, dto);
  }

  @Patch(':id')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Update a hashtag group' })
  update(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateHashtagGroupDto) {
    return this.hashtagGroupsService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Delete a hashtag group' })
  remove(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.hashtagGroupsService.remove(tenantId, id);
  }
}
