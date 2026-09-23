import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, RequireApiScopes } from '@htownautos/auth';
import { IdeaGroupInputDto, ReorderIdeaGroupsDto } from './dto';
import { SocialIdeaGroupsService } from './idea-groups.service';

@ApiTags('social-idea-groups')
@Controller('social/idea-groups')
export class SocialIdeaGroupsController {
  constructor(private readonly ideaGroupsService: SocialIdeaGroupsService) {}

  @Get()
  @RequireApiScopes('social:read')
  @ApiOperation({ summary: 'List idea groups — first call creates To Do / In Progress / Done' })
  list(@CurrentTenant() tenantId: string) {
    return this.ideaGroupsService.list(tenantId);
  }

  @Post()
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Create an idea group' })
  create(@CurrentTenant() tenantId: string, @Body() dto: IdeaGroupInputDto) {
    return this.ideaGroupsService.create(tenantId, dto);
  }

  @Post('reorder')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Reorder idea groups' })
  reorder(@CurrentTenant() tenantId: string, @Body() dto: ReorderIdeaGroupsDto) {
    return this.ideaGroupsService.reorder(tenantId, dto);
  }

  @Patch(':id')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Rename an idea group' })
  update(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: IdeaGroupInputDto) {
    return this.ideaGroupsService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Delete an idea group (its ideas move to Unassigned)' })
  remove(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.ideaGroupsService.remove(tenantId, id);
  }
}
