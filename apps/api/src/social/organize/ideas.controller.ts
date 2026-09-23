import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentTenant, CurrentUser, RequireApiScopes, type AuthenticatedUser } from '@htownautos/auth';
import { CreateIdeaDto, GenerateIdeasDto, IdeaListQueryDto, MoveIdeaDto, UpdateIdeaDto } from './dto';
import { SocialIdeasService } from './ideas.service';
import { SocialAiService } from './ai.service';

@ApiTags('social-ideas')
@Controller('social/ideas')
export class SocialIdeasController {
  constructor(
    private readonly ideasService: SocialIdeasService,
    private readonly aiService: SocialAiService,
  ) {}

  @Get()
  @RequireApiScopes('social:read')
  @ApiOperation({ summary: 'List ideas (groupId, tagIds, q filters)' })
  list(@CurrentTenant() tenantId: string, @Query() query: IdeaListQueryDto) {
    return this.ideasService.list(tenantId, query);
  }

  @Post()
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Create an idea' })
  create(@CurrentTenant() tenantId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateIdeaDto) {
    return this.ideasService.create(tenantId, user, dto);
  }

  @Post('generate')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'AI-generate up to 10 idea suggestions (not saved)' })
  generate(@Body() dto: GenerateIdeasDto) {
    return this.aiService.generateIdeas(dto);
  }

  @Patch(':id')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Update an idea' })
  update(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateIdeaDto) {
    return this.ideasService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Delete an idea' })
  remove(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.ideasService.remove(tenantId, id);
  }

  @Post(':id/move')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Move an idea to a group/position (drag and drop)' })
  move(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MoveIdeaDto) {
    return this.ideasService.move(tenantId, id, dto);
  }
}
