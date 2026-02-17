import {
  Controller,
  Get,
  Post,
  Body,
  Query,
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
import { PhoneCallService } from '../phone-call/phone-call.service';

const VoiceResponse = twilio.twiml.VoiceResponse;

@ApiTags('Twilio Client')
@Controller('twilio/client')
export class TwilioClientController {
  private readonly logger = new Logger(TwilioClientController.name);

  constructor(
    private readonly twilioService: TwilioService,
    private readonly prisma: PrismaService,
    private readonly phoneCallService: PhoneCallService,
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

    // Use userId for identity (tenantId:userId format for easy parsing)
    const result = this.twilioService.generateVoiceToken(user.id, tenantId);

    this.logger.log(`Generated voice token for user ${user.id} (${user.email}) in tenant ${tenantId}`);

    return {
      token: result.token,
      identity: result.identity,
      expiresIn: 3600,
    };
  }

  /**
   * Parse client identity to extract tenant ID and user ID
   * Client identity format: tenantId:userId
   * Example: 37721477-6bef-48cb-807f-53c97b44b6c0:abc123-def456-...
   */
  private parseClientIdentity(clientIdentity: string): { tenantId: string | null; userId: string | null } {
    if (!clientIdentity) {
      return { tenantId: null, userId: null };
    }

    // Strip 'client:' prefix if present
    const identity = clientIdentity.startsWith('client:')
      ? clientIdentity.replace('client:', '')
      : clientIdentity;

    // Format: tenantId:userId
    const colonIndex = identity.indexOf(':');
    if (colonIndex > 0) {
      const tenantId = identity.substring(0, colonIndex);
      const userId = identity.substring(colonIndex + 1);

      if (tenantId && userId) {
        this.logger.log(`Parsed client identity - tenantId: ${tenantId}, userId: ${userId}`);
        return { tenantId, userId };
      }
    }

    this.logger.warn(`Could not parse client identity: ${clientIdentity}`);
    return { tenantId: null, userId: null };
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
    this.logger.log(`Outgoing call request - From: ${body.From}, To: ${body.To}, CallerId: ${body.CallerId}, TenantId: ${body.TenantId}, CallSid: ${body.CallSid}`);

    const response = new VoiceResponse();

    // The 'To' parameter contains the destination (phone number or client identity)
    const to = body.To;
    const callSid = body.CallSid;

    // Parse client identity to get tenant ID and user ID
    // Format: tenantId:userId
    const parsed = this.parseClientIdentity(body.From);
    let tenantId = body.TenantId || parsed.tenantId || '';
    const userId = parsed.userId;

    this.logger.log(`Parsed client identity - tenantId: ${tenantId}, userId: ${userId}`);

    if (!to) {
      this.logger.warn('Outgoing call failed: No destination specified');
      response.say({ voice: 'alice' as any }, 'No destination specified.');
      response.hangup();
    } else if (to.startsWith('client:')) {
      // Calling another browser client
      const dial = response.dial({
        callerId: body.From,
      });
      dial.client(to.replace('client:', ''));
    } else {
      // Calling a phone number - need a valid E.164 caller ID
      let callerId = body.CallerId;

      // Validate CallerId is a proper phone number (E.164 format)
      if (!callerId || !callerId.startsWith('+') || callerId.includes('@')) {
        this.logger.warn(`Invalid CallerId: ${callerId}, attempting to find a valid number`);

        try {
          // First try to find the phone number from the tenant
          let phoneNumberRecord: { phoneNumber: string } | null = null;
          if (tenantId) {
            phoneNumberRecord = await this.prisma.twilioPhoneNumber.findFirst({
              where: { tenantId, isActive: true },
              orderBy: { isPrimary: 'desc' },
              select: { phoneNumber: true },
            });
          }

          // Fallback to any active phone number
          if (!phoneNumberRecord) {
            phoneNumberRecord = await this.prisma.twilioPhoneNumber.findFirst({
              where: { isActive: true },
              orderBy: { isPrimary: 'desc' },
              select: { phoneNumber: true },
            });
          }

          if (phoneNumberRecord) {
            callerId = phoneNumberRecord.phoneNumber;
            this.logger.log(`Using fallback CallerId: ${callerId}`);
          }
        } catch (err) {
          this.logger.error(`Failed to fetch fallback phone number: ${err.message}`);
        }
      }

      // Final validation
      if (!callerId || !callerId.startsWith('+')) {
        this.logger.error('Outgoing call failed: No valid caller ID available');
        response.say({ voice: 'alice' as any }, 'Unable to make outgoing calls. No valid caller ID configured.');
        response.hangup();
      } else {
        this.logger.log(`Making outbound call from ${callerId} to ${to}`);

        // Create call record for outbound call
        if (tenantId && callSid) {
          try {
            // Find the TenantUser by userId (parsed from client identity tenantId:userId)
            let callerTenantUserId: string | undefined = undefined;
            if (userId) {
              const tenantUser = await this.prisma.tenantUser.findFirst({
                where: {
                  tenantId,
                  userId,
                },
              });
              callerTenantUserId = tenantUser?.id;
              this.logger.log(`Found TenantUser: ${callerTenantUserId || 'none'} for userId ${userId}`);
            }

            await this.phoneCallService.createCall({
              tenantId,
              twilioCallSid: callSid,
              direction: 'outbound',
              fromNumber: callerId,
              toNumber: to,
              status: 'initiated',
              callerId: callerTenantUserId,
            });
            this.logger.log(`Created outbound call record for ${callSid}`);
          } catch (err) {
            this.logger.error(`Failed to create outbound call record: ${err.message}`);
          }
        }

        // Build callback URLs
        const baseUrl = process.env.API_BASE_URL || 'https://api.htownautos.com';
        const statusCallback = `${baseUrl}/api/v1/twilio/client/outgoing-status?tenantId=${encodeURIComponent(tenantId)}`;
        const recordingCallback = `${baseUrl}/api/v1/twilio/voice/recording/${tenantId}/${callSid}`;

        // Dial with recording enabled
        const dial = response.dial({
          callerId,
          action: statusCallback,
          method: 'POST',
          // Recording options - record both sides when answered
          record: 'record-from-answer-dual',
          recordingStatusCallback: recordingCallback,
          recordingStatusCallbackMethod: 'POST',
          recordingStatusCallbackEvent: ['completed'],
        });
        dial.number(to);

        this.logger.log(`Outbound call configured with recording callback: ${recordingCallback}`);
      }
    }

    res.type('text/xml');
    res.send(response.toString());
  }

  /**
   * Status callback for outbound calls
   * Updates call record when the call ends
   */
  @Post('outgoing-status')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleOutgoingStatus(
    @Body() body: Record<string, string>,
    @Query('tenantId') tenantId: string,
    @Res() res: express.Response,
  ) {
    // Log parameters from Twilio
    this.logger.log(`=== OUTGOING CALL STATUS CALLBACK ===`);
    this.logger.log(`TenantId from query: ${tenantId}`);
    this.logger.log(`Full body: ${JSON.stringify(body, null, 2)}`);

    const callSid = body.CallSid;
    const dialCallStatus = body.DialCallStatus;
    const dialCallDuration = body.DialCallDuration;

    this.logger.log(`Outgoing call status - CallSid: ${callSid}, TenantId: ${tenantId}, Status: ${dialCallStatus}, Duration: ${dialCallDuration}`);

    try {
      // Map Twilio dial status to our status
      let status = 'completed';
      if (dialCallStatus === 'no-answer') {
        status = 'no-answer';
      } else if (dialCallStatus === 'busy') {
        status = 'busy';
      } else if (dialCallStatus === 'failed') {
        status = 'failed';
      } else if (dialCallStatus === 'canceled') {
        status = 'canceled';
      }

      await this.phoneCallService.updateCallByTwilioSid(callSid, {
        status,
        duration: dialCallDuration ? parseInt(dialCallDuration, 10) : undefined,
        endedAt: new Date(),
        answeredAt: dialCallStatus === 'completed' ? new Date() : undefined,
      });

      this.logger.log(`Updated outbound call ${callSid} with status ${status}`);
    } catch (err) {
      this.logger.error(`Failed to update outbound call status: ${err.message}`);
    }

    // Return empty TwiML to end the call
    const response = new VoiceResponse();
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
