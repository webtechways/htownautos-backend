import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, RequireApiScopes } from '@htownautos/auth';
import { CommentListQueryDto, CommentReplyDto, MarkDoneDto, PatchCommentStatusDto } from './dto';
import { SocialCommentsService } from './comments.service';

@ApiTags('social-comments')
@Controller('social/comments')
export class SocialCommentsController {
  constructor(private readonly commentsService: SocialCommentsService) {}

  @Get()
  @RequireApiScopes('social:read')
  @ApiOperation({ summary: 'List top-level comments/mentions/reviews with filters' })
  list(@CurrentTenant() tenantId: string, @Query() query: CommentListQueryDto) {
    return this.commentsService.list(tenantId, query);
  }

  @Get('stats')
  @RequireApiScopes('social:read')
  @ApiOperation({ summary: 'Open/done counts, comment score and average response time' })
  stats(@CurrentTenant() tenantId: string) {
    return this.commentsService.stats(tenantId);
  }

  @Post('mark-done')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Bulk-mark top-level comments as done' })
  markDone(@CurrentTenant() tenantId: string, @Body() dto: MarkDoneDto) {
    return this.commentsService.markDone(tenantId, dto.ids);
  }

  @Get(':id/thread')
  @RequireApiScopes('social:read')
  @ApiOperation({ summary: 'Root comment plus its replies' })
  thread(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.commentsService.thread(tenantId, id);
  }

  @Post(':id/reply')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Reply on the platform; marks the thread root done' })
  reply(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CommentReplyDto) {
    return this.commentsService.reply(tenantId, id, dto);
  }

  @Post(':id/like')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Like a comment on the platform' })
  like(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.commentsService.like(tenantId, id);
  }

  @Post(':id/unlike')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Unlike a comment on the platform' })
  unlike(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.commentsService.unlike(tenantId, id);
  }

  @Post(':id/hide')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Hide a comment on the platform' })
  hide(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.commentsService.hide(tenantId, id);
  }

  @Post(':id/unhide')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Unhide a comment on the platform' })
  unhide(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.commentsService.unhide(tenantId, id);
  }

  @Delete(':id')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Delete a comment on the platform' })
  remove(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.commentsService.remove(tenantId, id);
  }

  @Patch(':id')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Set a comment thread status (open/done) without replying' })
  patchStatus(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PatchCommentStatusDto) {
    return this.commentsService.patchStatus(tenantId, id, dto.status);
  }
}
