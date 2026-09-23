import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, RequireApiScopes } from '@htownautos/auth';
import { CreateTemplateDto, UpdateTemplateDto } from './dto';
import { SocialTemplatesService } from './templates.service';

@ApiTags('social-templates')
@Controller('social/templates')
export class SocialTemplatesController {
  constructor(private readonly templatesService: SocialTemplatesService) {}

  @Get()
  @RequireApiScopes('social:read')
  @ApiOperation({ summary: 'List templates for the tenant, merged with the ~12 built-ins' })
  list(@CurrentTenant() tenantId: string) {
    return this.templatesService.list(tenantId);
  }

  @Post()
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Create a template' })
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateTemplateDto) {
    return this.templatesService.create(tenantId, dto);
  }

  @Patch(':id')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Update a template (400 for builtin:* ids)' })
  update(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    return this.templatesService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Delete a template (400 for builtin:* ids)' })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.templatesService.remove(tenantId, id);
  }
}
