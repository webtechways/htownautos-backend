import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, RequireApiScopes } from '@htownautos/auth';
import { QueueSlotsQueryDto } from './dto';
import { SocialQueueService } from './queue.service';

@ApiTags('social-queue')
@Controller('social/queue')
export class SocialQueueController {
  constructor(private readonly queueService: SocialQueueService) {}

  @Get('slots')
  @RequireApiScopes('social:read')
  @ApiOperation({ summary: 'Empty posting slots per channel within a date range (calendar "+ New" rows)' })
  slots(@CurrentTenant() tenantId: string, @Query() query: QueueSlotsQueryDto) {
    return this.queueService.emptySlots(tenantId, query.accountIds, query.from, query.to);
  }

  @Post(':accountId/shuffle')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: "Shuffle a channel's currently-queued slot times" })
  shuffle(@CurrentTenant() tenantId: string, @Param('accountId', ParseUUIDPipe) accountId: string) {
    return this.queueService.shuffle(tenantId, accountId);
  }
}
