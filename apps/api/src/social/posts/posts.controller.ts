import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ADMIN_ROLES, CurrentTenant, CurrentUser, RequireApiScopes, RequireRoles, RolesGuard, type AuthenticatedUser } from '@htownautos/auth';
import { CreatePostDto, MarkPublishedDto, PostListQueryDto, RejectDto, RescheduleDto, UpdatePostDto } from './dto';
import { SocialPostsService } from './posts.service';

@ApiTags('social-posts')
@Controller('social/posts')
export class SocialPostsController {
  constructor(private readonly postsService: SocialPostsService) {}

  @Get()
  @RequireApiScopes('social:read')
  @ApiOperation({ summary: 'List posts by tab (queue/drafts/approvals/sent) with filters' })
  list(@CurrentTenant() tenantId: string, @Query() query: PostListQueryDto) {
    return this.postsService.list(tenantId, query);
  }

  @Get(':id')
  @RequireApiScopes('social:read')
  @ApiOperation({ summary: 'Get one post' })
  getOne(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.postsService.getOne(tenantId, id);
  }

  @Post()
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Create a post (draft/queue/next/now/custom)' })
  create(@CurrentTenant() tenantId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePostDto) {
    return this.postsService.create(tenantId, user, dto);
  }

  @Patch(':id')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Update a post (409 if any target is publishing/published)' })
  update(@CurrentTenant() tenantId: string, @CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePostDto) {
    return this.postsService.update(tenantId, user, id, dto);
  }

  @Delete(':id')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Delete a post' })
  remove(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.postsService.remove(tenantId, id);
  }

  @Post(':id/duplicate')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Duplicate a post as a new draft' })
  duplicate(@CurrentTenant() tenantId: string, @CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.postsService.duplicate(tenantId, user, id);
  }

  @Post(':id/publish-now')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Publish every pending channel of this post immediately' })
  publishNow(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.postsService.publishNow(tenantId, id);
  }

  @Post(':id/reschedule')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Reschedule one channel, or every not-yet-published channel, to a new time' })
  reschedule(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RescheduleDto) {
    return this.postsService.reschedule(tenantId, id, dto);
  }

  @Post(':id/request-approval')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Send a draft to approval' })
  requestApproval(@CurrentTenant() tenantId: string, @CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.postsService.requestApproval(tenantId, user, id);
  }

  @Post(':id/approve')
  @UseGuards(RolesGuard)
  @RequireRoles(...ADMIN_ROLES)
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Approve a pending post (admin only) — computes slots and publishes anything already due' })
  approve(@CurrentTenant() tenantId: string, @CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.postsService.approve(tenantId, user, id);
  }

  @Post(':id/reject')
  @UseGuards(RolesGuard)
  @RequireRoles(...ADMIN_ROLES)
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Reject a pending post back to draft (admin only)' })
  reject(@CurrentTenant() tenantId: string, @CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectDto) {
    return this.postsService.reject(tenantId, user, id, dto);
  }

  @Post(':id/targets/:targetId/retry')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Retry a failed channel now' })
  retryTarget(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Param('targetId', ParseUUIDPipe) targetId: string) {
    return this.postsService.retryTarget(tenantId, id, targetId);
  }

  @Post(':id/targets/:targetId/mark-published')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Manually confirm a reminder-channel target was posted' })
  markPublished(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('targetId', ParseUUIDPipe) targetId: string,
    @Body() dto: MarkPublishedDto,
  ) {
    return this.postsService.markPublished(tenantId, id, targetId, dto);
  }
}
