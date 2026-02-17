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
  Header,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiExcludeEndpoint } from '@nestjs/swagger';
import * as express from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { CallFlowService } from '../call-flow/call-flow.service';
import { TwimlGeneratorService, CallContext } from '../call-flow/twiml-generator.service';
import { CallFlowStep, CallFlowStepType, MenuStepConfig } from '../call-flow/dto/call-flow.dto';
import { PhoneCallService } from '../phone-call/phone-call.service';
import { SmsService } from '../sms/sms.service';

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
    private readonly phoneCallService: PhoneCallService,
    private readonly smsService: SmsService,
  ) {}

  /**
   * Build call context from webhook payload
   */
  private buildCallContext(
    tenantId: string,
    phoneNumberId: string,
    payload: TwilioVoiceWebhookDto,
    callFlowId: string,
    recordCalls = false,
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
      recordCalls,
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

    // Create call record in database
    try {
      await this.phoneCallService.createCall({
        tenantId,
        twilioCallSid: payload.CallSid,
        direction: 'inbound',
        fromNumber: payload.From,
        toNumber: payload.To,
        status: 'ringing',
      });
    } catch (err) {
      this.logger.error(`Failed to create call record: ${err.message}`);
    }

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

      // Build call context with recording setting
      const context = this.buildCallContext(tenantId, phoneId, payload, callFlow.id, callFlow.recordInboundCalls);

      // Start executing the call flow
      const twiml = await this.twimlGenerator.startCallFlow(
        callFlow.steps,
        context,
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
      const context = this.buildCallContext(tenantId, phoneId, payload, callFlow.id, callFlow.recordInboundCalls);
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
            // No digit received (timeout) - go to invalid input steps or hangup
            const step = callFlow.steps[currentStep];
            if (step?.type === CallFlowStepType.MENU) {
              const config = step.config as MenuStepConfig;
              if (config.invalidInputSteps?.length) {
                // Execute nested invalid input steps (inlined, no redirects back to main flow)
                twiml = await this.twimlGenerator.executeNestedSteps(
                  config.invalidInputSteps as CallFlowStep[],
                  0,
                  context,
                );
              } else {
                // No invalid input steps (Do nothing) = just hangup
                twiml = this.twimlGenerator.generateHangupTwiml();
              }
            } else {
              twiml = this.twimlGenerator.generateHangupTwiml();
            }
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
          // Handle invalid input (timeout via redirect fallback)
          const step = callFlow.steps[currentStep];
          if (step?.type === CallFlowStepType.MENU) {
            const config = step.config as MenuStepConfig;
            if (config.invalidInputSteps?.length) {
              // Execute nested invalid input steps (inlined, no redirects back to main flow)
              twiml = await this.twimlGenerator.executeNestedSteps(
                config.invalidInputSteps as CallFlowStep[],
                0,
                context,
              );
            } else {
              // No invalid input steps (Do nothing) = just hangup
              twiml = this.twimlGenerator.generateHangupTwiml();
            }
          } else {
            twiml = this.twimlGenerator.generateHangupTwiml();
          }
          break;
        }

        case 'round_robin': {
          // Handle round robin dial completion
          // This is called when the conference ends (caller leaves or is redirected)
          // The 'attempt' query param indicates which attempt just completed
          const attempt = parseInt(queryParams.attempt || '1', 10);
          const attemptIndex = attempt - 1; // Convert to 0-indexed (which agent was being called)

          // Check if the call was actually answered (agent joined conference)
          const callWasInProgress = await this.phoneCallService.wasCallAnswered(payload.CallSid);

          this.logger.log(`Round robin dial.action callback: attemptIndex=${attemptIndex}, callWasInProgress=${callWasInProgress}`);

          if (callWasInProgress) {
            // Call was actually answered by an agent - associate the user who answered
            try {
              await this.associateRoundRobinUser(tenantId, payload.CallSid, callFlow.steps, currentStep, attemptIndex);
            } catch (err) {
              this.logger.error(`Failed to associate round-robin user: ${err.message}`);
            }
            // Call was answered and ended, we're done - hangup the caller
            const twilio = require('twilio');
            const response = new twilio.twiml.VoiceResponse();
            response.hangup();
            twiml = response.toString();
          } else {
            // Agent never answered
            // The agent-status callback handles redirecting to the next agent
            // This dial.action is just a fallback - if we get here, just hangup
            // (the agent-status callback should have already redirected the caller)
            this.logger.log(`Round robin dial.action: agent did not answer, agent-status callback should have handled redirect`);
            const twilio = require('twilio');
            const response = new twilio.twiml.VoiceResponse();
            response.hangup();
            twiml = response.toString();
          }
          break;
        }

        case 'round_robin_redirect': {
          // Handle redirect from agent-status callback to next round robin agent
          // This is triggered when an agent doesn't answer and we redirect to try the next one
          const attemptIndex = parseInt(queryParams.attempt || '0', 10);

          this.logger.log(`Round robin redirect: trying agent at index ${attemptIndex}`);

          // Execute the round robin step with the new attempt index
          twiml = await this.twimlGenerator.executeStep(
            callFlow.steps,
            currentStep,
            context,
            { attempt: attemptIndex.toString() },
          );
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
      const context = this.buildCallContext(tenantId, phoneId, payload, callFlow.id, callFlow.recordInboundCalls);
      const currentStep = parseInt(stepIndex, 10);

      // With conference-based routing, DialCallStatus='completed' just means the caller
      // joined the conference, NOT that an agent answered. We need to check the database.
      const callWasAnswered = await this.phoneCallService.wasCallAnswered(payload.CallSid);

      this.logger.log(`Dial status callback: DialCallStatus=${payload.DialCallStatus}, callWasAnswered=${callWasAnswered}`);

      // If call was actually answered (agent joined conference), associate the user
      if (callWasAnswered) {
        try {
          await this.associateAnsweringUser(tenantId, payload.CallSid, callFlow.steps, currentStep);
        } catch (err) {
          this.logger.error(`Failed to associate answering user: ${err.message}`);
        }
      }

      // Use actual answered status instead of DialCallStatus
      const effectiveStatus = callWasAnswered ? 'completed' : 'no-answer';
      const twiml = await this.twimlGenerator.handleDialStatus(
        callFlow.steps,
        currentStep,
        effectiveStatus,
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
   * Handle nested dial status callback (when dial in nested flow completes)
   * POST /api/v1/twilio/voice/flow/:tenantId/:phoneId/nested-dial-status
   */
  @Post('voice/flow/:tenantId/:phoneId/nested-dial-status')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleNestedDialStatus(
    @Param('tenantId') tenantId: string,
    @Param('phoneId') phoneId: string,
    @Query('rrAttempt') rrAttempt: string,
    @Body() payload: TwilioVoiceWebhookDto,
    @Res() res: express.Response,
  ) {
    this.logger.debug(
      `Nested dial status for tenant ${tenantId}, phone ${phoneId}: ${payload.DialCallStatus}`,
    );

    try {
      const result = await this.callFlowService.getCallFlowForPhoneNumber(phoneId);

      if (!result?.callFlow) {
        res.type('text/xml');
        res.send(this.twimlGenerator.generateDefaultTwiml(tenantId));
        return;
      }

      const { callFlow } = result;
      const context = this.buildCallContext(tenantId, phoneId, payload, callFlow.id, callFlow.recordInboundCalls);

      // Check if call was actually answered
      const callWasAnswered = await this.phoneCallService.wasCallAnswered(payload.CallSid);

      this.logger.log(`Nested dial status: DialCallStatus=${payload.DialCallStatus}, callWasAnswered=${callWasAnswered}, rrAttempt=${rrAttempt}`);

      // If call was answered, try to associate the user
      if (callWasAnswered) {
        try {
          await this.associateNestedDialUser(tenantId, payload.CallSid);
        } catch (err) {
          this.logger.error(`Failed to associate nested dial user: ${err.message}`);
        }
      }

      const twiml = await this.twimlGenerator.handleNestedDialStatus(
        payload.CallSid,
        context,
        callWasAnswered,
        rrAttempt ? parseInt(rrAttempt, 10) : undefined,
      );

      res.type('text/xml');
      res.send(twiml);
    } catch (error) {
      this.logger.error(`Error handling nested dial status: ${error.message}`, error.stack);
      res.type('text/xml');
      res.send(this.twimlGenerator.generateDefaultTwiml(tenantId));
    }
  }

  /**
   * Helper to associate user for nested dial (uses stored metadata)
   */
  private async associateNestedDialUser(
    tenantId: string,
    callSid: string,
  ): Promise<void> {
    // The conferenceTarget stored in metadata contains the user ID
    const call = await this.phoneCallService.getCallByTwilioSid(callSid);
    if (!call) return;

    const metaValue = (call as any).metaValue || {};
    const conferenceTarget = metaValue.conferenceTarget;

    if (conferenceTarget && this.isUUID(conferenceTarget)) {
      const tenantUser = await this.callFlowService.findTenantUserByUserId(tenantId, conferenceTarget);
      if (tenantUser) {
        await this.phoneCallService.associateUserWithCall(callSid, tenantUser.id);
        this.logger.log(`Associated nested dial user ${conferenceTarget} with call ${callSid}`);
      }
    }
  }

  /**
   * Helper to associate the user who answered an inbound call
   */
  private async associateAnsweringUser(
    tenantId: string,
    callSid: string,
    steps: CallFlowStep[],
    stepIndex: number,
  ): Promise<void> {
    const step = steps[stepIndex];
    if (!step) return;

    let userId: string | null = null;

    // Extract the user ID from the step config
    if (step.type === 'dial') {
      const config = step.config as { destination?: string };
      if (config.destination && this.isUUID(config.destination)) {
        userId = config.destination;
      }
    } else if (step.type === 'simulcall') {
      const config = step.config as { destinations?: string[] };
      // For simulcall, we'd need to track which specific user answered
      // For now, if there's only one destination, use it
      if (config.destinations?.length === 1 && this.isUUID(config.destinations[0])) {
        userId = config.destinations[0];
      }
    }

    if (userId) {
      // Find the TenantUser for this user in this tenant
      const tenantUser = await this.callFlowService.findTenantUserByUserId(tenantId, userId);
      if (tenantUser) {
        await this.phoneCallService.associateUserWithCall(callSid, tenantUser.id);
        this.logger.log(`Associated user ${userId} (TenantUser: ${tenantUser.id}) with call ${callSid}`);
      }
    }
  }

  /**
   * Check if a string is a UUID
   */
  private isUUID(str: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
  }

  /**
   * Helper to associate the user who answered a round-robin call
   */
  private async associateRoundRobinUser(
    tenantId: string,
    callSid: string,
    steps: CallFlowStep[],
    stepIndex: number,
    attemptIndex: number,
  ): Promise<void> {
    const step = steps[stepIndex];
    if (!step || step.type !== 'round_robin') return;

    const config = step.config as { destinations?: string[] };
    if (!config.destinations || attemptIndex >= config.destinations.length) return;

    const destination = config.destinations[attemptIndex];
    if (this.isUUID(destination)) {
      const tenantUser = await this.callFlowService.findTenantUserByUserId(tenantId, destination);
      if (tenantUser) {
        await this.phoneCallService.associateUserWithCall(callSid, tenantUser.id);
        this.logger.log(`Associated round-robin user ${destination} (TenantUser: ${tenantUser.id}) with call ${callSid}`);
      }
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
    this.logger.debug(`CallSid: ${payload.CallSid}, Status: ${payload.CallStatus}, Duration: ${payload.CallDuration}`);

    if (!payload.CallSid || !payload.CallStatus) {
      return { success: true };
    }

    try {
      // Map Twilio status to our status
      const statusMap: Record<string, string> = {
        'initiated': 'initiated',
        'ringing': 'ringing',
        'in-progress': 'in-progress',
        'completed': 'completed',
        'busy': 'busy',
        'no-answer': 'no-answer',
        'failed': 'failed',
        'canceled': 'canceled',
      };

      const callStatus = payload.CallStatus;
      const mappedStatus = statusMap[callStatus] || callStatus;

      // Get the original call record
      const originalCall = await this.phoneCallService.getCallByTwilioSid(payload.CallSid);

      // For terminal statuses (completed, failed, etc.), find the active segment to update
      if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(callStatus)) {
        // Find the most recent non-terminal segment to mark as completed
        const activeSegment = await this.phoneCallService.getLatestCallSegment(payload.CallSid);

        if (activeSegment && activeSegment.status !== 'transferred' && activeSegment.twilioCallSid) {
          // Update the active segment to completed with duration
          await this.phoneCallService.updateCallByTwilioSid(activeSegment.twilioCallSid, {
            status: mappedStatus,
            endedAt: new Date(),
            duration: payload.CallDuration ? parseInt(payload.CallDuration, 10) : undefined,
          });
          this.logger.log(`Call completed: Updated segment ${activeSegment.twilioCallSid} to ${mappedStatus}`);
        } else {
          this.logger.log(`Call completed: No active segment found for ${payload.CallSid}, all segments transferred`);
        }
      } else {
        // For non-terminal statuses (ringing, in-progress), update the original call
        if (originalCall && originalCall.status !== 'transferred') {
          const updateData: any = { status: mappedStatus };

          if (callStatus === 'in-progress') {
            updateData.answeredAt = new Date();
          }

          await this.phoneCallService.updateCallByTwilioSid(payload.CallSid, updateData);
          this.logger.log(`Updated call ${payload.CallSid} to ${mappedStatus}`);
        }
      }
    } catch (err) {
      this.logger.error(`Failed to update call status: ${err.message}`);
    }

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
    this.logger.debug(`Recording URL: ${payload.RecordingUrl}, Duration: ${payload.RecordingDuration}`);

    // Update call record to mark it as voicemail
    try {
      await this.phoneCallService.updateCallByTwilioSid(callSid, {
        outcome: 'voicemail',
        status: 'completed',
        endedAt: new Date(),
      });

      // Process the voicemail recording (download from Twilio and upload to S3)
      if (payload.RecordingUrl && payload.RecordingSid) {
        await this.phoneCallService.processRecording(
          callSid,
          payload.RecordingSid,
          payload.RecordingUrl,
          parseInt(payload.RecordingDuration || '0', 10),
        );
        this.logger.log(`Voicemail recording processed for call ${callSid}`);
      }
    } catch (err) {
      this.logger.error(`Failed to process voicemail: ${err.message}`);
    }

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

    // Store transcription in database
    if (payload.TranscriptionText) {
      try {
        await this.phoneCallService.updateTranscription(
          callSid,
          JSON.stringify({ text: payload.TranscriptionText, source: 'twilio' }),
          'completed',
        );
        this.logger.log(`Voicemail transcription stored for call ${callSid}`);
      } catch (err) {
        this.logger.error(`Failed to store voicemail transcription: ${err.message}`);
      }
    }

    return { success: true };
  }

  /**
   * Provide ringing tone TwiML for conference wait
   * GET /api/v1/twilio/voice/ring
   * This plays audio while the caller waits for an agent
   */
  @Get('voice/ring')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/xml')
  @ApiExcludeEndpoint()
  getRingTwiml() {
    // Generate TwiML that provides audio feedback while waiting for agent
    const VoiceResponse = require('twilio').twiml.VoiceResponse;
    const response = new VoiceResponse();

    // Brief message to let caller know they're connecting, then periodic reminders
    response.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      'Please wait while we connect your call.',
    );

    // Add pauses with occasional messages to simulate waiting
    // This is more reliable than external audio URLs
    for (let i = 0; i < 5; i++) {
      response.pause({ length: 10 });
      response.say(
        { voice: 'Polly.Joanna', language: 'en-US' },
        'Please continue to hold.',
      );
    }

    // Final long pause
    response.pause({ length: 30 });

    return response.toString();
  }

  /**
   * Handle call recording status callback (legacy - no segment)
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
    this.logger.debug(`Recording SID: ${payload.RecordingSid}, Status: ${payload.RecordingStatus}, URL: ${payload.RecordingUrl}`);

    // Only process when recording is completed
    if (payload.RecordingStatus === 'completed' && payload.RecordingUrl && payload.RecordingSid) {
      try {
        // Process recording - download from Twilio and upload to S3
        await this.phoneCallService.processRecording(
          callSid,
          payload.RecordingSid,
          payload.RecordingUrl,
          parseInt(payload.RecordingDuration || '0', 10),
        );
        this.logger.log(`Recording processed for call ${callSid}`);
      } catch (err) {
        this.logger.error(`Failed to process recording: ${err.message}`);
      }
    }

    return { success: true };
  }

  /**
   * Handle call recording status callback with segment number
   * POST /api/v1/twilio/voice/recording/:tenantId/:callSid/:segmentNumber
   */
  @Post('voice/recording/:tenantId/:callSid/:segmentNumber')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleSegmentRecordingStatus(
    @Param('tenantId') tenantId: string,
    @Param('callSid') callSid: string,
    @Param('segmentNumber') segmentNumber: string,
    @Body() payload: Record<string, string>,
  ) {
    const segment = parseInt(segmentNumber, 10);
    this.logger.log(`Recording status for tenant ${tenantId}, call ${callSid}, segment ${segment}`);
    this.logger.debug(`Recording SID: ${payload.RecordingSid}, Status: ${payload.RecordingStatus}, URL: ${payload.RecordingUrl}`);

    // Only process when recording is completed
    if (payload.RecordingStatus === 'completed' && payload.RecordingUrl && payload.RecordingSid) {
      try {
        // Process recording for specific segment
        await this.phoneCallService.processSegmentRecording(
          callSid,
          segment,
          payload.RecordingSid,
          payload.RecordingUrl,
          parseInt(payload.RecordingDuration || '0', 10),
        );
        this.logger.log(`Recording processed for call ${callSid} segment ${segment}`);
      } catch (err) {
        this.logger.error(`Failed to process segment recording: ${err.message}`);
      }
    }

    return { success: true };
  }

  /**
   * Handle conference status events
   * POST /api/v1/twilio/voice/conference/:tenantId/:callSid/:segmentNumber
   */
  @Post('voice/conference/:tenantId/:callSid/:segmentNumber')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleConferenceStatus(
    @Param('tenantId') tenantId: string,
    @Param('callSid') callSid: string,
    @Param('segmentNumber') segmentNumber: string,
    @Query('attempt') attempt: string,
    @Body() payload: Record<string, string>,
  ) {
    const segment = parseInt(segmentNumber, 10);
    const attemptIndex = attempt ? parseInt(attempt, 10) : 0;

    this.logger.log(`Conference event for tenant ${tenantId}, call ${callSid}, segment ${segment}`);
    this.logger.debug(`Conference: ${payload.ConferenceSid}, Event: ${payload.StatusCallbackEvent}, FriendlyName: ${payload.FriendlyName}`);

    const conferenceSid = payload.ConferenceSid;
    const eventType = payload.StatusCallbackEvent;
    const conferenceName = payload.FriendlyName;

    try {
      switch (eventType) {
        case 'conference-start':
          // Conference started - just log it
          // Agent dialing is now handled in participant-join when the caller joins
          this.logger.log(`Conference started: ${conferenceName}`);
          break;

        case 'participant-join':
          this.logger.log(`Participant joined conference ${conferenceName}: ${payload.CallSid}`);
          if (payload.CallSid === callSid) {
            // This is the original caller joining - dial the agent(s) into the conference
            // This handles the case where conference-start event might not arrive
            this.logger.log(`Caller joined conference, dialing agent(s) into ${conferenceName}`);
            await this.phoneCallService.updateConferenceInfo(callSid, segment, conferenceSid, conferenceName);
            await this.phoneCallService.dialAgentIntoConference(callSid, segment, conferenceName, tenantId);
          } else {
            // This is an agent joining - associate them with the call
            await this.phoneCallService.handleAgentJoinedConference(callSid, segment, payload.CallSid);
          }
          break;

        case 'participant-leave':
          this.logger.log(`Participant left conference ${conferenceName}: ${payload.CallSid}`);
          if (payload.CallSid === callSid) {
            // The original caller left - terminate any pending agent calls
            this.logger.log(`Caller left conference, terminating pending agent calls`);
            await this.phoneCallService.terminatePendingAgentCalls(callSid, segment);
          } else {
            // An agent left the conference
            // Check if the call was transferred - if so, don't terminate the caller
            // (they've been redirected to a new conference)
            const callRecord = await this.phoneCallService.getCallByOriginalSidAndSegment(callSid, segment);
            if (callRecord?.status === 'transferred') {
              this.logger.log(`Agent left conference but call was transferred - not terminating caller`);
            } else {
              // Agent left and call not transferred - terminate the caller's call
              this.logger.log(`Agent left conference, terminating caller's call`);
              await this.phoneCallService.terminateCallerCall(callSid);
            }
          }
          break;

        case 'conference-end':
          this.logger.log(`Conference ended: ${conferenceName}`);
          // Conference recording will be handled by the recording callback
          // Also ensure any pending agent calls are terminated
          await this.phoneCallService.terminatePendingAgentCalls(callSid, segment);
          break;
      }
    } catch (err) {
      this.logger.error(`Failed to handle conference event: ${err.message}`);
    }

    return { success: true };
  }

  /**
   * Handle agent call status callback
   * POST /api/v1/twilio/voice/agent-status/:tenantId/:callSid/:segmentNumber
   * This is called when the outbound call to an agent ends
   */
  @Post('voice/agent-status/:tenantId/:callSid/:segmentNumber')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleAgentCallStatus(
    @Param('tenantId') tenantId: string,
    @Param('callSid') callSid: string,
    @Param('segmentNumber') segmentNumber: string,
    @Query('phoneId') phoneId: string,
    @Query('step') step: string,
    @Query('attempt') attempt: string,
    @Body() payload: Record<string, string>,
  ) {
    const segment = parseInt(segmentNumber, 10);
    const agentCallSid = payload.CallSid;
    const callStatus = payload.CallStatus;

    this.logger.log(`Agent call status for tenant ${tenantId}, caller ${callSid}, segment ${segment}`);
    this.logger.debug(`Agent CallSid: ${agentCallSid}, Status: ${callStatus}`);

    // Only process when call ends (final status)
    if (callStatus === 'completed' || callStatus === 'busy' || callStatus === 'no-answer' || callStatus === 'failed' || callStatus === 'canceled') {
      try {
        const wasAnswered = await this.phoneCallService.handleAgentCallStatus(
          callSid,
          segment,
          agentCallSid,
          callStatus,
        );

        // If agent didn't answer (no-answer, busy, failed, canceled) and no more pending agents,
        // redirect caller to next round robin attempt (for round_robin)
        // or to next call flow step (for dial/simulcall)
        // or terminate the call (for transfers)
        if (!wasAnswered && callStatus !== 'completed') {
          const attemptFailed = await this.phoneCallService.didConferenceAttemptFail(callSid, segment);
          if (attemptFailed) {
            if (phoneId && step) {
              // Regular call flow - redirect to next step
              const currentAttempt = parseInt(attempt || '0', 10);
              const nextAttempt = currentAttempt + 1;

              this.logger.log(`All agents failed for ${callSid}, checking step type to determine next action`);

              // Get the call flow to check the step type
              const result = await this.callFlowService.getCallFlowForPhoneNumber(phoneId);
              if (result?.callFlow) {
                const stepIndex = parseInt(step, 10);
                const stepConfig = result.callFlow.steps[stepIndex];

                const baseUrl = process.env.API_BASE_URL || 'https://api.htownautos.com';
                const twilio = require('twilio');
                const response = new twilio.twiml.VoiceResponse();

                if (stepConfig?.type === 'round_robin' && stepConfig.config) {
                  // Round robin: try next agent or continue to next step
                  const destinations = (stepConfig.config as any).destinations || [];

                  if (nextAttempt < destinations.length) {
                    // Redirect caller to next attempt
                    // nextAttempt is 0-indexed, and executeStep uses attempt directly as attemptIndex
                    const redirectUrl = `${baseUrl}/api/v1/twilio/voice/flow/${tenantId}/${phoneId}?step=${step}&action=round_robin_redirect&attempt=${nextAttempt}`;
                    response.redirect({ method: 'POST' }, redirectUrl);

                    await this.phoneCallService.redirectCallerCall(callSid, response.toString());
                    this.logger.log(`Redirected caller ${callSid} to round robin agent at index ${nextAttempt}`);
                  } else {
                    // No more destinations - continue to next step in call flow
                    const nextStepIndex = stepIndex + 1;
                    this.logger.log(`No more round robin destinations for ${callSid}, continuing to step ${nextStepIndex}`);

                    const redirectUrl = `${baseUrl}/api/v1/twilio/voice/flow/${tenantId}/${phoneId}?step=${nextStepIndex}`;
                    response.redirect({ method: 'POST' }, redirectUrl);

                    await this.phoneCallService.redirectCallerCall(callSid, response.toString());
                    this.logger.log(`Redirected caller ${callSid} to next call flow step ${nextStepIndex}`);
                  }
                } else if (stepConfig?.type === 'dial' || stepConfig?.type === 'simulcall') {
                  // DIAL or SIMULCALL: agent(s) didn't answer, continue to next step
                  const nextStepIndex = stepIndex + 1;
                  this.logger.log(`${stepConfig.type} failed for ${callSid}, continuing to step ${nextStepIndex}`);

                  const redirectUrl = `${baseUrl}/api/v1/twilio/voice/flow/${tenantId}/${phoneId}?step=${nextStepIndex}`;
                  response.redirect({ method: 'POST' }, redirectUrl);

                  await this.phoneCallService.redirectCallerCall(callSid, response.toString());
                  this.logger.log(`Redirected caller ${callSid} to next call flow step ${nextStepIndex}`);
                }
              }
            } else {
              // No phoneId/step - could be a nested flow or transfer
              // Check if this is a nested flow by looking at metadata
              const callRecord = await this.phoneCallService.getCallByTwilioSid(callSid);
              const metaValue = (callRecord as any)?.metaValue || {};

              if (metaValue.isNestedFlow) {
                // This is a nested flow - execute remaining nested steps or hangup
                this.logger.log(`Nested flow agent didn't answer for ${callSid}, checking for remaining steps`);

                const nestedPhoneId = metaValue.phoneNumberId;
                if (nestedPhoneId) {
                  const result = await this.callFlowService.getCallFlowForPhoneNumber(nestedPhoneId);
                  if (result?.callFlow) {
                    const context = this.buildCallContext(
                      tenantId,
                      nestedPhoneId,
                      { CallSid: callSid, From: callRecord?.fromNumber || '', To: callRecord?.toNumber || '' } as any,
                      result.callFlow.id,
                      result.callFlow.recordInboundCalls,
                    );

                    const twiml = await this.twimlGenerator.handleNestedDialStatus(
                      callSid,
                      context,
                      false, // callWasAnswered = false
                      metaValue.nestedRoundRobin?.currentAttempt,
                    );

                    await this.phoneCallService.redirectCallerCall(callSid, twiml);
                    this.logger.log(`Redirected caller ${callSid} to nested flow fallback`);
                  } else {
                    // No call flow found - terminate the call
                    this.logger.log(`No call flow found for nested flow ${callSid}, terminating`);
                    await this.phoneCallService.terminateCallerCall(callSid);
                  }
                } else {
                  this.logger.log(`No phoneNumberId for nested flow ${callSid}, terminating`);
                  await this.phoneCallService.terminateCallerCall(callSid);
                }
              } else if (segment > 0) {
                // Transfer segment - no phoneId/step means this was a transfer
                // If transfer target didn't answer, terminate the caller's call
                this.logger.log(`Transfer target didn't answer for ${callSid} segment ${segment}, terminating caller's call`);
                await this.phoneCallService.terminateCallerCall(callSid);

                // Update the transfer segment status to failed
                const transferCallRecord = await this.phoneCallService.getCallByOriginalSidAndSegment(callSid, segment);
                if (transferCallRecord) {
                  await this.phoneCallService.updateCallByTwilioSid(transferCallRecord.twilioCallSid!, { status: 'failed' });
                }
              }
            }

            // Clear the flag
            await this.phoneCallService.clearConferenceAttemptFailed(callSid, segment);
          }
        }
      } catch (err) {
        this.logger.error(`Failed to handle agent call status: ${err.message}`);
      }
    }

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

    try {
      // Store the incoming SMS and emit real-time event
      await this.smsService.handleIncomingSms(tenantId, phoneId, {
        MessageSid: payload.MessageSid,
        From: payload.From,
        To: payload.To,
        Body: payload.Body,
        NumMedia: payload.NumMedia,
        NumSegments: payload.NumSegments,
      });
    } catch (error) {
      this.logger.error(`Failed to handle incoming SMS: ${error.message}`);
    }

    // Return empty TwiML (no auto-reply)
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

    try {
      if (payload.MessageSid && payload.MessageStatus) {
        await this.smsService.handleSmsStatusUpdate(tenantId, {
          MessageSid: payload.MessageSid,
          MessageStatus: payload.MessageStatus,
          ErrorCode: payload.ErrorCode,
          ErrorMessage: payload.ErrorMessage,
        });
      }
    } catch (error) {
      this.logger.error(`Failed to handle SMS status update: ${error.message}`);
    }

    return { success: true };
  }
}
