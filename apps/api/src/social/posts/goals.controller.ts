import { Body, Controller, Get, ParseArrayPipe, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, RequireApiScopes } from '@htownautos/auth';
import { SocialGoalInputDto } from './dto';
import { SocialGoalsService } from './goals.service';

@ApiTags('social-goals')
@Controller('social/goals')
export class SocialGoalsController {
  constructor(private readonly goalsService: SocialGoalsService) {}

  @Get()
  @RequireApiScopes('social:read')
  @ApiOperation({ summary: 'Weekly posting goal per publishable channel, defaults filled in' })
  list(@CurrentTenant() tenantId: string) {
    return this.goalsService.list(tenantId);
  }

  @Put()
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Replace the weekly posting goals for the given channels' })
  update(@CurrentTenant() tenantId: string, @Body(new ParseArrayPipe({ items: SocialGoalInputDto })) dto: SocialGoalInputDto[]) {
    return this.goalsService.update(tenantId, dto);
  }
}
