import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentTenant, RequireApiScopes } from '@htownautos/auth';
import { AiComposeDto, AiReplyDto } from './dto';
import { SocialAiService } from './ai.service';

const THROTTLE = { default: { limit: 20, ttl: 60_000 } };

@ApiTags('social-ai')
@Controller('social/ai')
export class SocialAiController {
  constructor(private readonly aiService: SocialAiService) {}

  @Post('compose')
  @Throttle(THROTTLE)
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Generate/rephrase/shorten/expand/fix/hashtags/translate/tone a post draft' })
  compose(@Body() dto: AiComposeDto) {
    return this.aiService.compose(dto);
  }

  @Post('reply-suggestion')
  @Throttle(THROTTLE)
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: '3 short reply suggestions for an inbox conversation or a comment thread' })
  replySuggestion(@CurrentTenant() tenantId: string, @Body() dto: AiReplyDto) {
    return this.aiService.replySuggestion(tenantId, dto);
  }
}
