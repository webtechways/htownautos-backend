import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, RequireApiScopes } from '@htownautos/auth';
import { UpdatePostingScheduleDto } from './dto';
import { SocialSchedulesService } from './schedules.service';

@ApiTags('social-schedules')
@Controller('social/schedules')
export class SocialSchedulesController {
  constructor(private readonly schedulesService: SocialSchedulesService) {}

  @Get()
  @RequireApiScopes('social:read')
  @ApiOperation({ summary: 'Posting schedule per publishable channel, defaults filled in' })
  list(@CurrentTenant() tenantId: string) {
    return this.schedulesService.list(tenantId);
  }

  @Put(':accountId')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: "Update a channel's posting schedule" })
  update(@CurrentTenant() tenantId: string, @Param('accountId', ParseUUIDPipe) accountId: string, @Body() dto: UpdatePostingScheduleDto) {
    return this.schedulesService.update(tenantId, accountId, dto);
  }
}
