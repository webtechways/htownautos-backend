import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, RequireApiScopes } from '@htownautos/auth';
import { CreateTagDto, UpdateTagDto } from './dto';
import { SocialTagsService } from './tags.service';

@ApiTags('social-tags')
@Controller('social/tags')
export class SocialTagsController {
  constructor(private readonly tagsService: SocialTagsService) {}

  @Get()
  @RequireApiScopes('social:read')
  @ApiOperation({ summary: 'List tags for the tenant' })
  list(@CurrentTenant() tenantId: string) {
    return this.tagsService.list(tenantId);
  }

  @Post()
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Create a tag (409 if the name is already used)' })
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateTagDto) {
    return this.tagsService.create(tenantId, dto);
  }

  @Patch(':id')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Update a tag' })
  update(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTagDto) {
    return this.tagsService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Delete a tag' })
  remove(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.tagsService.remove(tenantId, id);
  }
}
