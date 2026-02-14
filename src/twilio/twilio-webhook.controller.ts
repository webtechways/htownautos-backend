import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
  Res,
  Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiExcludeEndpoint } from '@nestjs/swagger';
import * as express from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { CallFlowService } from '../call-flow/call-flow.service';
import { TwimlGeneratorService, CallContext } from '../call-flow/twiml-generator.service';
import { CallFlowStep, CallFlowStepType, MenuStepConfig } from '../call-flow/dto/call-flow.dto';

// Twilio Voice Webhook DTO (subset of Twilio's webhook payload)
interface TwilioVoiceWebhookDto {
  CallSid: string;
  AccountSid: string;
  From: string;
  To: string;
  CallStatus: string;
  ApiVersion: string;
  Direction: string;
  ForwardedFrom?: string;
  CallerName?: string;
  FromCity?: string;
  FromState?: string;
  FromZip?: string;
  FromCountry?: string;
  ToCity?: string;
  ToState?: string;
  ToZip?: string;
  ToCountry?: string;
  Digits?: string;
  DialCallStatus?: string;
  DialCallDuration?: string;
  RecordingUrl?: string;
  RecordingSid?: string;
  RecordingDuration?: string;
}

// Twilio SMS Webhook DTO
interface TwilioSmsWebhookDto {
  MessageSid: string;
  AccountSid: string;
  From: string;
  To: string;
  Body: string;
  NumMedia: string;
  NumSegments: string;
  SmsStatus?: string;
  ApiVersion: string;
  FromCity?: string;
  FromState?: string;
  FromZip?: string;
  FromCountry?: string;
  ToCity?: string;
  ToState?: string;
  ToZip?: string;
  ToCountry?: string;
  MediaUrl0?: string;
  MediaContentType0?: string;
}

// Twilio Status Callback DTO
interface TwilioStatusCallbackDto {
  CallSid?: string;
  MessageSid?: string;
  AccountSid: string;
  From: string;
  To: string;
  CallStatus?: string;
  MessageStatus?: string;
  CallDuration?: string;
  Timestamp?: string;
  ErrorCode?: string;
  ErrorMessage?: string;
}

@ApiTags('Twilio Webhooks')
@Controller('twilio')
export class TwilioWebhookController {
  private readonly logger = new Logger(TwilioWebhookController.name);

  constructor(
    private readonly callFlowService: CallFlowService,
    private readonly twimlGenerator: TwimlGeneratorService,
  ) {}

  /**
   * Build call context from webhook payload
   */
  private buildCallContext(
    tenantId: string,
    phoneNumberId: string,
    payload: TwilioVoiceWebhookDto,
    callFlowId: string,
  ): CallContext {
    return {
      tenantId,
      phoneNumberId,
      callSid: payload.CallSid,
      from: payload.From,
      to: payload.To,
      callFlowId,
      variables: {},
      tags: [],
    };
  }

  /**
   * Handle incoming voice calls from Twilio
   * POST /api/v1/twilio/voice/incoming/:tenantId/:phoneId
   */
  @Post('voice/incoming/:tenantId/:phoneId')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleIncomingVoice(
    @Param('tenantId') tenantId: string,
    @Param('phoneId') phoneId: string,
    @Body() payload: TwilioVoiceWebhookDto,
    @Headers('x-twilio-signature') twilioSignature: string,
    @Res() res: express.Response,
  ) {
    this.logger.log(`Incoming voice call for tenant ${tenantId}, phone ${phoneId}`);
    this.logger.debug(`Call from ${payload.From} to ${payload.To}, CallSid: ${payload.CallSid}`);

    try {
      // Get call flow for this phone number
      const result = await this.callFlowService.getCallFlowForPhoneNumber(phoneId);

      if (!result) {
        this.logger.warn(`Phone number ${phoneId} not found`);
        res.type('text/xml');
        res.send(this.twimlGenerator.generateDefaultTwiml(tenantId));
        return;
      }

      const { callFlow, phoneNumber } = result;

      // If no call flow configured, use default
      if (!callFlow || !callFlow.isActive) {
        this.logger.debug(`No active call flow for phone ${phoneId}`);
        res.type('text/xml');
        res.send(this.twimlGenerator.generateDefaultTwiml(tenantId));
        return;
      }

      // Build call context
      const context = this.buildCallContext(tenantId, phoneId, payload, callFlow.id);

      // Start executing the call flow
      const twiml = await this.twimlGenerator.startCallFlow(
        callFlow.steps,
        context,
        callFlow.recordInboundCalls,
      );

      this.logger.debug(`Generated TwiML for call flow ${callFlow.id}`);
      res.type('text/xml');
      res.send(twiml);
    } catch (error) {
      this.logger.error(`Error handling incoming call: ${error.message}`, error.stack);
      res.type('text/xml');
      res.send(this.twimlGenerator.generateDefaultTwiml(tenantId));
    }
  }

  /**
   * Handle call flow step continuation
   * POST /api/v1/twilio/voice/flow/:tenantId/:phoneId
   */
  @Post('voice/flow/:tenantId/:phoneId')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleFlowContinuation(
    @Param('tenantId') tenantId: string,
    @Param('phoneId') phoneId: string,
    @Query('step') stepIndex: string,
    @Query('action') action: string,
    @Query() queryParams: Record<string, string>,
    @Body() payload: TwilioVoiceWebhookDto,
    @Res() res: express.Response,
  ) {
    this.logger.debug(
      `Flow continuation for tenant ${tenantId}, phone ${phoneId}, step ${stepIndex}, action ${action}`,
    );

    try {
      const result = await this.callFlowService.getCallFlowForPhoneNumber(phoneId);

      if (!result?.callFlow) {
        res.type('text/xml');
        res.send(this.twimlGenerator.generateDefaultTwiml(tenantId));
        return;
      }

      const { callFlow } = result;
      const context = this.buildCallContext(tenantId, phoneId, payload, callFlow.id);
      const currentStep = parseInt(stepIndex, 10);

      let twiml: string;

      switch (action) {
        case 'menu': {
          // Handle menu digit selection
          const digit = payload.Digits;
          if (digit) {
            twiml = await this.twimlGenerator.handleMenuSelection(
              callFlow.steps,
              currentStep,
              digit,
              context,
            );
          } else {
            // No digit received, retry menu
            twiml = await this.twimlGenerator.executeStep(
              callFlow.steps,
              currentStep,
              context,
              { retry: (parseInt(queryParams.retry || '0', 10) + 1).toString() },
            );
          }
          break;
        }

        case 'menu_retry': {
          // Retry menu
          const retryCount = parseInt(queryParams.retry || '0', 10);
          twiml = await this.twimlGenerator.executeStep(
            callFlow.steps,
            currentStep,
            context,
            { retry: retryCount.toString() },
          );
          break;
        }

        case 'menu_invalid': {
          // Max retries reached, handle invalid input
          const step = callFlow.steps[currentStep];
          if (step?.type === CallFlowStepType.MENU) {
            const config = step.config as MenuStepConfig;
            if (config.invalidInputSteps?.length) {
              twiml = await this.twimlGenerator.executeStep(
                config.invalidInputSteps as CallFlowStep[],
                0,
                context,
              );
            } else {
              // Continue to next step
              twiml = await this.twimlGenerator.executeStep(
                callFlow.steps,
                currentStep + 1,
                context,
              );
            }
          } else {
            twiml = await this.twimlGenerator.executeStep(
              callFlow.steps,
              currentStep + 1,
              context,
            );
          }
          break;
        }

        case 'round_robin': {
          // Handle round robin next attempt
          const dialStatus = payload.DialCallStatus;
          if (dialStatus === 'completed') {
            // Call was answered, we're done
            const twilio = require('twilio');
            const response = new twilio.twiml.VoiceResponse();
            response.hangup();
            twiml = response.toString();
          } else {
            // Try next number
            const attempt = parseInt(queryParams.attempt || '0', 10);
            twiml = await this.twimlGenerator.executeStep(
              callFlow.steps,
              currentStep,
              context,
              { attempt: attempt.toString() },
            );
          }
          break;
        }

        case 'keypad': {
          // Handle keypad input
          const digit = payload.Digits;
          if (digit) {
            // Store the variable
            const varName = queryParams.var || 'keypad_input';
            context.variables[varName] = digit;
            this.logger.debug(`Stored keypad input: ${varName}=${digit}`);
          }
          // Continue to next step
          twiml = await this.twimlGenerator.executeStep(
            callFlow.steps,
            currentStep + 1,
            context,
          );
          break;
        }

        default: {
          // Normal step execution
          twiml = await this.twimlGenerator.executeStep(
            callFlow.steps,
            currentStep,
            context,
            queryParams,
          );
        }
      }

      res.type('text/xml');
      res.send(twiml);
    } catch (error) {
      this.logger.error(`Error handling flow continuation: ${error.message}`, error.stack);
      res.type('text/xml');
      res.send(this.twimlGenerator.generateDefaultTwiml(tenantId));
    }
  }

  /**
   * Handle dial status callback (when dial completes)
   * POST /api/v1/twilio/voice/flow/:tenantId/:phoneId/dial-status
   */
  @Post('voice/flow/:tenantId/:phoneId/dial-status')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleDialStatus(
    @Param('tenantId') tenantId: string,
    @Param('phoneId') phoneId: string,
    @Query('step') stepIndex: string,
    @Body() payload: TwilioVoiceWebhookDto,
    @Res() res: express.Response,
  ) {
    this.logger.debug(
      `Dial status for tenant ${tenantId}, phone ${phoneId}: ${payload.DialCallStatus}`,
    );

    try {
      const result = await this.callFlowService.getCallFlowForPhoneNumber(phoneId);

      if (!result?.callFlow) {
        res.type('text/xml');
        res.send(this.twimlGenerator.generateDefaultTwiml(tenantId));
        return;
      }

      const { callFlow } = result;
      const context = this.buildCallContext(tenantId, phoneId, payload, callFlow.id);
      const currentStep = parseInt(stepIndex, 10);

      const twiml = await this.twimlGenerator.handleDialStatus(
        callFlow.steps,
        currentStep,
        payload.DialCallStatus || 'failed',
        context,
      );

      res.type('text/xml');
      res.send(twiml);
    } catch (error) {
      this.logger.error(`Error handling dial status: ${error.message}`, error.stack);
      res.type('text/xml');
      res.send(this.twimlGenerator.generateDefaultTwiml(tenantId));
    }
  }

  /**
   * Handle voice call status callbacks
   * POST /api/v1/twilio/voice/incoming/:tenantId/:phoneId/status
   */
  @Post('voice/incoming/:tenantId/:phoneId/status')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleVoiceStatus(
    @Param('tenantId') tenantId: string,
    @Param('phoneId') phoneId: string,
    @Body() payload: TwilioStatusCallbackDto,
    @Headers('x-twilio-signature') twilioSignature: string,
  ) {
    this.logger.log(`Voice status update for tenant ${tenantId}, phone ${phoneId}`);
    this.logger.debug(`CallSid: ${payload.CallSid}, Status: ${payload.CallStatus}`);

    // TODO: Update call record in database with new status
    // TODO: Handle completed calls (duration, recording URL, etc.)

    return { success: true };
  }

  /**
   * Handle voicemail recording callback
   * POST /api/v1/twilio/voice/voicemail/:tenantId/:callSid
   */
  @Post('voice/voicemail/:tenantId/:callSid')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleVoicemailRecording(
    @Param('tenantId') tenantId: string,
    @Param('callSid') callSid: string,
    @Body() payload: TwilioVoiceWebhookDto,
    @Res() res: express.Response,
  ) {
    this.logger.log(`Voicemail received for tenant ${tenantId}, call ${callSid}`);
    this.logger.debug(`Recording URL: ${payload.RecordingUrl}`);

    // TODO: Store voicemail recording in database
    // TODO: Send notification email if configured

    const twilio = require('twilio');
    const response = new twilio.twiml.VoiceResponse();
    response.say({ voice: 'alice' }, 'Thank you for your message. Goodbye.');
    response.hangup();

    res.type('text/xml');
    res.send(response.toString());
  }

  /**
   * Handle voicemail transcription callback
   * POST /api/v1/twilio/voice/transcription/:tenantId/:callSid
   */
  @Post('voice/transcription/:tenantId/:callSid')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleTranscription(
    @Param('tenantId') tenantId: string,
    @Param('callSid') callSid: string,
    @Body() payload: Record<string, string>,
  ) {
    this.logger.log(`Transcription received for tenant ${tenantId}, call ${callSid}`);
    this.logger.debug(`Transcription: ${payload.TranscriptionText?.substring(0, 100)}...`);

    // TODO: Store transcription in database

    return { success: true };
  }

  /**
   * Handle call recording status callback
   * POST /api/v1/twilio/voice/recording/:tenantId/:callSid
   */
  @Post('voice/recording/:tenantId/:callSid')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleRecordingStatus(
    @Param('tenantId') tenantId: string,
    @Param('callSid') callSid: string,
    @Body() payload: Record<string, string>,
  ) {
    this.logger.log(`Recording status for tenant ${tenantId}, call ${callSid}`);
    this.logger.debug(`Recording SID: ${payload.RecordingSid}, Status: ${payload.RecordingStatus}`);

    // TODO: Store recording URL in database

    return { success: true };
  }

  /**
   * Handle incoming SMS messages from Twilio
   * POST /api/v1/twilio/sms/incoming/:tenantId/:phoneId
   */
  @Post('sms/incoming/:tenantId/:phoneId')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleIncomingSms(
    @Param('tenantId') tenantId: string,
    @Param('phoneId') phoneId: string,
    @Body() payload: TwilioSmsWebhookDto,
    @Headers('x-twilio-signature') twilioSignature: string,
    @Res() res: express.Response,
  ) {
    this.logger.log(`Incoming SMS for tenant ${tenantId}, phone ${phoneId}`);
    this.logger.debug(`SMS from ${payload.From} to ${payload.To}: ${payload.Body?.substring(0, 50)}...`);

    // TODO: Implement SMS handling logic
    // 1. Validate Twilio signature
    // 2. Look up tenant and phone number
    // 3. Find or create conversation thread
    // 4. Store message in database
    // 5. Notify assigned user via WebSocket/push notification
    // 6. Return TwiML response (optional auto-reply)

    // For now, return empty TwiML (no auto-reply)
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>`;

    res.type('text/xml');
    res.send(twiml);
  }

  /**
   * Handle SMS delivery status callbacks
   * POST /api/v1/twilio/sms/incoming/:tenantId/:phoneId/status
   */
  @Post('sms/incoming/:tenantId/:phoneId/status')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleSmsStatus(
    @Param('tenantId') tenantId: string,
    @Param('phoneId') phoneId: string,
    @Body() payload: TwilioStatusCallbackDto,
    @Headers('x-twilio-signature') twilioSignature: string,
  ) {
    this.logger.log(`SMS status update for tenant ${tenantId}, phone ${phoneId}`);
    this.logger.debug(`MessageSid: ${payload.MessageSid}, Status: ${payload.MessageStatus}`);

    // TODO: Update SMS record in database with delivery status

    return { success: true };
  }
}
