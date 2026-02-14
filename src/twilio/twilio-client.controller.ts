import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import * as express from 'express';
import * as twilio from 'twilio';
import { TwilioService } from './twilio.service';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma.service';
import { CognitoJwtGuard } from '../auth/guards/cognito-jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';

const VoiceResponse = twilio.twiml.VoiceResponse;

@ApiTags('Twilio Client')
@Controller('twilio/client')
export class TwilioClientController {
  private readonly logger = new Logger(TwilioClientController.name);

  constructor(
    private readonly twilioService: TwilioService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Get a Twilio access token for the authenticated user
   * This token allows the user to receive calls in their browser
   */
  @Get('token')
  @UseGuards(CognitoJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get Twilio Voice token for browser calling' })
  @ApiResponse({ status: 200, description: 'Token generated successfully' })
  async getVoiceToken(
    @CurrentUser() user: { id: string; email: string },
    @CurrentTenant() tenantId: string,
  ) {
    if (!user?.id || !tenantId) {
      this.logger.error(`Missing auth data - userId: ${user?.id}, tenantId: ${tenantId}`);
      throw new Error('User must be authenticated with a tenant selected');
    }

    // Use email as identity (more readable in Twilio console)
    const identity = user.email || user.id;

    const result = this.twilioService.generateVoiceToken(identity, tenantId);

    this.logger.log(`Generated voice token for user ${user.email} in tenant ${tenantId}`);

    return {
      token: result.token,
      identity: result.identity,
      expiresIn: 3600,
    };
  }

  /**
   * TwiML App callback - handles outgoing calls from the browser
   * This endpoint is called by Twilio when a user makes an outgoing call from the browser
   */
  @Post('outgoing')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleOutgoingCall(
    @Body() body: Record<string, string>,
    @Res() res: express.Response,
  ) {
    this.logger.log(`Outgoing call request from client: ${body.From} to ${body.To}`);

    const response = new VoiceResponse();

    // The 'To' parameter contains the destination (phone number or client identity)
    const to = body.To;

    if (!to) {
      response.say({ voice: 'alice' as any }, 'No destination specified.');
      response.hangup();
    } else if (to.startsWith('client:')) {
      // Calling another browser client
      const dial = response.dial({
        callerId: body.From,
      });
      dial.client(to.replace('client:', ''));
    } else {
      // Calling a phone number
      const dial = response.dial({
        callerId: body.CallerId || body.From,
      });
      dial.number(to);
    }

    res.type('text/xml');
    res.send(response.toString());
  }

  /**
   * Handle incoming calls to a Twilio Client (browser)
   * This is used when the call flow dials a user's browser
   */
  @Post('incoming/:identity')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleIncomingClientCall(
    @Body() body: Record<string, string>,
    @Res() res: express.Response,
  ) {
    const identity = body.identity || '';
    this.logger.log(`Routing call to client: ${identity}`);

    const response = new VoiceResponse();
    const dial = response.dial();
    dial.client(identity);

    res.type('text/xml');
    res.send(response.toString());
  }

  /**
   * Get or create TwiML App SID
   * This is an admin endpoint to help with initial setup
   */
  @Get('setup-twiml-app')
  @UseGuards(CognitoJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create or get TwiML App SID for voice client' })
  @ApiResponse({ status: 200, description: 'TwiML App SID' })
  async setupTwimlApp() {
    const appSid = await this.twilioService.getOrCreateTwimlApp();
    return {
      twimlAppSid: appSid,
      message: 'Add this SID to your .env file as TWILIO_TWIML_APP_SID',
    };
  }
}
