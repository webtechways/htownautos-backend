import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, RequireApiScopes } from '@htownautos/auth';
import { SocialHomeService } from './home.service';

@ApiTags('social-home')
@Controller('social/home')
export class SocialHomeController {
  constructor(private readonly homeService: SocialHomeService) {}

  @Get()
  @RequireApiScopes('social:read')
  @ApiOperation({ summary: 'Social Suite dashboard: streak, goals, comment score, counts, up next, recent comments, first steps' })
  get(@CurrentTenant() tenantId: string) {
    return this.homeService.get(tenantId);
  }
}
