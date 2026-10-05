import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Req, ServiceUnavailableException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { RequireApiScopes } from '@htownautos/auth';
import { TwilioService } from '../twilio/twilio.service';

class SendAlertSmsDto {
  /** US/Canada mobile in E.164. */
  @IsString()
  @Matches(/^\+1\d{10}$/)
  to: string;

  @IsString()
  @MinLength(1)
  @MaxLength(480)
  body: string;
}

interface ApiKeyRequest {
  apiKey?: { id: string };
}

/**
 * Outbound text alerts for partner sites (PrecioFinal's Alert Center:
 * verification codes and new-lot alerts). API keys only, from the dedicated
 * sender in ALERT_SMS_MESSAGING_SERVICE_SID or ALERT_SMS_FROM — never a
 * dealership's own number.
 */
@ApiTags('Alert SMS')
@ApiBearerAuth()
@Controller('alert-sms')
export class AlertSmsController {
  constructor(private readonly twilio: TwilioService) {}

  private sender(): { from?: string; messagingServiceSid?: string } | null {
    const messagingServiceSid = process.env.ALERT_SMS_MESSAGING_SERVICE_SID?.trim();
    const from = process.env.ALERT_SMS_FROM?.trim();
    if (messagingServiceSid) return { messagingServiceSid };
    if (from) return { from };
    return null;
  }

  @Get('status')
  @RequireApiScopes('alert-sms:read')
  @ApiOperation({ summary: 'Whether alert texts can be sent (a sender is configured)' })
  status(@Req() req: ApiKeyRequest) {
    if (!req.apiKey) throw new ForbiddenException('API keys only');
    return { configured: !!this.sender() };
  }

  @Post()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @RequireApiScopes('alert-sms:write')
  @ApiOperation({ summary: 'Send one alert text to a US/Canada mobile' })
  async send(@Body() dto: SendAlertSmsDto, @Req() req: ApiKeyRequest) {
    if (!req.apiKey) throw new ForbiddenException('API keys only');
    const sender = this.sender();
    if (!sender) throw new ServiceUnavailableException('Alert SMS sender is not configured');
    if (!dto.body.trim()) throw new BadRequestException('Empty message');
    const { sid, status } = await this.twilio.sendSms({ to: dto.to, body: dto.body, ...sender });
    return { sid, status };
  }
}
