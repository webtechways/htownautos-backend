import { Injectable, Logger } from '@nestjs/common';
import * as twilio from 'twilio';
import {
  CallFlowStep,
  CallFlowStepType,
  MessageConfig,
  MessageType,
  GreetingStepConfig,
  DialStepConfig,
  SimulcallStepConfig,
  RoundRobinStepConfig,
  MenuStepConfig,
  ScheduleStepConfig,
  KeypadEntryStepConfig,
  TagStepConfig,
  VoicemailStepConfig,
  HangupStepConfig,
} from './dto/call-flow.dto';
import { PrismaService } from '../prisma.service';

const VoiceResponse = twilio.twiml.VoiceResponse;

export interface CallContext {
  tenantId: string;
  phoneNumberId: string;
  callSid: string;
  from: string;
  to: string;
  callFlowId: string;
  variables: Record<string, string>;
  tags: string[];
  recordCalls: boolean;
  segmentNumber?: number; // For tracking transfer segments
}

/**
 * Generate a unique conference name for a call segment
 */
export function generateConferenceName(callSid: string, segmentNumber: number): string {
  return `call_${callSid}_seg_${segmentNumber}`;
}

export interface StepExecutionResult {
  twiml: string;
  continueProcessing: boolean;
  nextStepIndex?: number;
}

@Injectable()
export class TwimlGeneratorService {
  private readonly logger = new Logger(TwimlGeneratorService.name);
  private readonly baseUrl: string;

  constructor(private readonly prisma: PrismaService) {
    this.baseUrl = process.env.API_BASE_URL || 'https://api.htownautos.com';
  }

  /**
   * Build the callback URL for flow continuation
   */
  private buildFlowUrl(
    tenantId: string,
    phoneNumberId: string,
    stepIndex: number,
    extra: Record<string, string> = {},
  ): string {
    const params = new URLSearchParams({ step: stepIndex.toString(), ...extra });
    return `${this.baseUrl}/api/v1/twilio/voice/flow/${tenantId}/${phoneNumberId}?${params}`;
  }

  /**
   * Build the dial status callback URL
   */
  private buildDialStatusUrl(
    tenantId: string,
    phoneNumberId: string,
    stepIndex: number,
  ): string {
    return `${this.baseUrl}/api/v1/twilio/voice/flow/${tenantId}/${phoneNumberId}/dial-status?step=${stepIndex}`;
  }

  /**
   * Generate <Say> or <Play> based on message config
   * If generatedAudioUrl is available (from OpenAI TTS), use <Play>
   * Otherwise, fall back to Twilio's native TTS
   */
  private addMessage(response: twilio.twiml.VoiceResponse, message: MessageConfig): void {
    if (message.type === MessageType.RECORDING && message.recordingUrl) {
      response.play(message.recordingUrl);
    } else if (message.type === MessageType.TTS) {
      // Prefer pre-generated audio URL (from OpenAI TTS)
      if (message.generatedAudioUrl) {
        response.play(message.generatedAudioUrl);
      } else if (message.text) {
        // Fall back to Twilio's native TTS with default voice
        response.say(
          {
            voice: 'alice' as any,
            language: message.language || 'en-US',
          },
          message.text,
        );
      }
    }
  }

  /**
   * Process a greeting step
   */
  private processGreeting(
    response: twilio.twiml.VoiceResponse,
    config: GreetingStepConfig,
  ): void {
    this.addMessage(response, config.message);
  }

  /**
   * Check if destination is a user identity (email) or phone number
   */
  private isUserIdentity(destination: string): boolean {
    // If it contains @ it's likely an email (user identity)
    return destination.includes('@');
  }

  /**
   * Check if destination is a UUID (user ID)
   */
  private isUUID(destination: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(destination);
  }

  /**
   * Look up user email by user ID
   */
  private async getUserEmailById(userId: string): Promise<string | null> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      return user?.email || null;
    } catch (error) {
      this.logger.error(`Failed to lookup user ${userId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Build client identity for Twilio Client
   * Must match the format used in TwilioService.generateVoiceToken
   * Format: tenantId:userId
   */
  private buildClientIdentity(userId: string, tenantId: string): string {
    return `${tenantId}:${userId}`;
  }

  /**
   * Process a dial step - uses conference for better recording control
   * Each call segment gets its own conference with separate recording
   */
  private async processDial(
    response: twilio.twiml.VoiceResponse,
    config: DialStepConfig,
    context: CallContext,
    stepIndex: number,
  ): Promise<void> {
    this.logger.log(`processDial - destination: "${config.destination}", isUserIdentity: ${this.isUserIdentity(config.destination)}, isUUID: ${this.isUUID(config.destination)}, isExtension: ${config.isExtension}`);

    // Determine if we should record this call (either step-level or call flow level)
    const shouldRecord = config.record || context.recordCalls;
    const segmentNumber = context.segmentNumber || 0;
    const conferenceName = generateConferenceName(context.callSid, segmentNumber);

    this.logger.log(`Using conference: ${conferenceName}, segment: ${segmentNumber}, recording: ${shouldRecord}`);

    // Conference options for the caller (external party)
    const conferenceOptions: any = {
      startConferenceOnEnter: true,
      endConferenceOnExit: true, // End conference when caller hangs up
      beep: false,
      waitUrl: `${this.baseUrl}/api/v1/twilio/voice/ring`, // Play ringing while waiting for agent
      waitMethod: 'GET',
      statusCallback: `${this.baseUrl}/api/v1/twilio/voice/conference/${context.tenantId}/${context.callSid}/${segmentNumber}`,
      statusCallbackEvent: ['start', 'end', 'join', 'leave'],
      statusCallbackMethod: 'POST',
    };

    // Add recording at conference level if enabled
    if (shouldRecord) {
      conferenceOptions.record = 'record-from-start';
      conferenceOptions.recordingStatusCallback = `${this.baseUrl}/api/v1/twilio/voice/recording/${context.tenantId}/${context.callSid}/${segmentNumber}`;
      conferenceOptions.recordingStatusCallbackMethod = 'POST';
      this.logger.log(`Conference recording enabled for segment ${segmentNumber}`);
    }

    // Dial options with action callback for when conference ends
    const dialOptions: any = {
      timeout: config.timeout || 30,
      action: this.buildDialStatusUrl(context.tenantId, context.phoneNumberId, stepIndex),
      method: 'POST',
    };

    const dial = response.dial(dialOptions);

    // Add conference element - caller joins this conference
    dial.conference(conferenceOptions, conferenceName);

    // Now we need to dial the agent into the same conference
    // This is done via a separate outbound call to the agent
    // The agent call will be initiated by the conference status callback when the conference starts
    // Store the target info for the callback to use
    await this.storeConferenceTarget(context, conferenceName, config.destination, segmentNumber, stepIndex, undefined, config.timeout);
  }

  /**
   * Store conference target info for callback to dial the agent
   */
  private async storeConferenceTarget(
    context: CallContext,
    conferenceName: string,
    destination: string,
    segmentNumber: number,
    stepIndex?: number,
    attemptIndex?: number,
    timeout?: number,
  ): Promise<void> {
    // Update the phone call record with conference info and target
    try {
      this.logger.log(`storeConferenceTarget: callSid=${context.callSid}, destination=${destination}, segmentNumber=${segmentNumber}, timeout=${timeout}`);

      // First, find the call record to get existing metaValue
      const existingCall = await this.prisma.phoneCall.findFirst({
        where: { twilioCallSid: context.callSid },
      });

      if (!existingCall) {
        this.logger.warn(`storeConferenceTarget: No call record found for callSid=${context.callSid} - call record may not exist yet`);
        return;
      }

      // Merge with existing metaValue to avoid overwriting other data
      const existingMetaValue = (existingCall.metaValue as any) || {};
      const newMetaValue = {
        ...existingMetaValue,
        conferenceTarget: destination,
        conferenceCallerId: context.from,
        phoneNumberId: context.phoneNumberId,
        stepIndex,
        attemptIndex,
        dialTimeout: timeout,
      };

      // Use update with id for more reliable update
      await this.prisma.phoneCall.update({
        where: { id: existingCall.id },
        data: {
          conferenceName,
          segmentNumber,
          metaValue: newMetaValue,
        },
      });

      this.logger.log(`storeConferenceTarget: updated call ${existingCall.id} with conferenceTarget=${destination}`);
    } catch (error) {
      this.logger.error(`Failed to store conference target: ${error.message}`);
    }
  }

  /**
   * Process a simulcall step - uses conference, multiple agents join simultaneously
   */
  private async processSimulcall(
    response: twilio.twiml.VoiceResponse,
    config: SimulcallStepConfig,
    context: CallContext,
    stepIndex: number,
  ): Promise<void> {
    const segmentNumber = context.segmentNumber || 0;
    const conferenceName = generateConferenceName(context.callSid, segmentNumber);

    this.logger.log(`Simulcall using conference: ${conferenceName}, segment: ${segmentNumber}`);

    // Conference options for the caller
    const conferenceOptions: any = {
      startConferenceOnEnter: true,
      endConferenceOnExit: true,
      beep: false,
      waitUrl: `${this.baseUrl}/api/v1/twilio/voice/ring`,
      waitMethod: 'GET',
      statusCallback: `${this.baseUrl}/api/v1/twilio/voice/conference/${context.tenantId}/${context.callSid}/${segmentNumber}`,
      statusCallbackEvent: ['start', 'end', 'join', 'leave'],
      statusCallbackMethod: 'POST',
    };

    // Add recording if enabled at call flow level
    if (context.recordCalls) {
      conferenceOptions.record = 'record-from-start';
      conferenceOptions.recordingStatusCallback = `${this.baseUrl}/api/v1/twilio/voice/recording/${context.tenantId}/${context.callSid}/${segmentNumber}`;
      conferenceOptions.recordingStatusCallbackMethod = 'POST';
      this.logger.log(`Conference recording enabled for simulcall segment ${segmentNumber}`);
    }

    const dialOptions: any = {
      timeout: config.timeout || 30,
      action: this.buildDialStatusUrl(context.tenantId, context.phoneNumberId, stepIndex),
      method: 'POST',
    };

    const dial = response.dial(dialOptions);
    dial.conference(conferenceOptions, conferenceName);

    // Store all targets for the conference callback to dial
    await this.storeConferenceTarget(context, conferenceName, config.destinations.join(','), segmentNumber, stepIndex, undefined, config.timeout);
  }

  /**
   * Process a round robin step - uses conference, tries agents sequentially
   */
  private async processRoundRobin(
    response: twilio.twiml.VoiceResponse,
    config: RoundRobinStepConfig,
    context: CallContext,
    stepIndex: number,
    attemptIndex = 0,
  ): Promise<void> {
    if (attemptIndex >= config.destinations.length) {
      // All destinations tried, continue to next step
      response.redirect(
        { method: 'POST' },
        this.buildFlowUrl(context.tenantId, context.phoneNumberId, stepIndex + 1),
      );
      return;
    }

    const segmentNumber = context.segmentNumber || 0;
    const conferenceName = generateConferenceName(context.callSid, segmentNumber);
    const destination = config.destinations[attemptIndex];

    this.logger.log(`RoundRobin using conference: ${conferenceName}, attempt: ${attemptIndex}, destination: ${destination}`);

    // Conference options
    const conferenceOptions: any = {
      startConferenceOnEnter: true,
      endConferenceOnExit: true,
      beep: false,
      waitUrl: `${this.baseUrl}/api/v1/twilio/voice/ring`,
      waitMethod: 'GET',
      statusCallback: `${this.baseUrl}/api/v1/twilio/voice/conference/${context.tenantId}/${context.callSid}/${segmentNumber}?attempt=${attemptIndex}`,
      statusCallbackEvent: ['start', 'end', 'join', 'leave'],
      statusCallbackMethod: 'POST',
    };

    // Add recording if enabled at call flow level
    if (context.recordCalls) {
      conferenceOptions.record = 'record-from-start';
      conferenceOptions.recordingStatusCallback = `${this.baseUrl}/api/v1/twilio/voice/recording/${context.tenantId}/${context.callSid}/${segmentNumber}`;
      conferenceOptions.recordingStatusCallbackMethod = 'POST';
      this.logger.log(`Conference recording enabled for round robin segment ${segmentNumber}`);
    }

    const dialOptions: any = {
      timeout: config.timeoutPerDestination || 20,
      action: this.buildFlowUrl(context.tenantId, context.phoneNumberId, stepIndex, {
        action: 'round_robin',
        attempt: (attemptIndex + 1).toString(),
      }),
      method: 'POST',
    };

    const dial = response.dial(dialOptions);
    dial.conference(conferenceOptions, conferenceName);

    // Store target for conference callback (include step and attempt for round robin retry)
    await this.storeConferenceTarget(context, conferenceName, destination, segmentNumber, stepIndex, attemptIndex, config.timeoutPerDestination);
  }

  /**
   * Process a menu step - IVR with options
   */
  private processMenu(
    response: twilio.twiml.VoiceResponse,
    config: MenuStepConfig,
    context: CallContext,
    stepIndex: number,
  ): void {
    const gather = response.gather({
      input: ['dtmf'],
      numDigits: config.numDigits || 1,
      timeout: config.timeout || 20,
      action: this.buildFlowUrl(context.tenantId, context.phoneNumberId, stepIndex, {
        action: 'menu',
      }),
      method: 'POST',
    });

    // Add the prompt message inside gather
    if (config.message.type === MessageType.RECORDING && config.message.recordingUrl) {
      gather.play(config.message.recordingUrl);
    } else if (config.message.type === MessageType.TTS) {
      // Prefer pre-generated audio URL (from OpenAI TTS)
      if (config.message.generatedAudioUrl) {
        gather.play(config.message.generatedAudioUrl);
      } else if (config.message.text) {
        // Fall back to Twilio's native TTS
        gather.say(
          {
            voice: 'alice' as any,
            language: config.message.language || 'en-US',
          },
          config.message.text,
        );
      }
    }

    // If no input after timeout, go directly to invalid input steps (no retry loop)
    response.redirect(
      { method: 'POST' },
      this.buildFlowUrl(context.tenantId, context.phoneNumberId, stepIndex, {
        action: 'menu_invalid',
      }),
    );
  }

  /**
   * Find which schedule branch matches the current time
   * Returns the matching branch index, or -1 if no match (use fallback)
   */
  private findMatchingScheduleBranch(config: ScheduleStepConfig): number {
    const now = new Date();

    // Convert to timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: config.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short',
    });

    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
    const dayName = parts.find(p => p.type === 'weekday')?.value || '';

    // Map day name to number (0=Sunday)
    const dayMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    const dayOfWeek = dayMap[dayName] ?? 0;
    const currentTime = hour * 60 + minute; // Minutes since midnight

    // Day presets
    const weekdays = [1, 2, 3, 4, 5];
    const weekends = [0, 6];
    const everyday = [0, 1, 2, 3, 4, 5, 6];

    // Check each branch
    for (let branchIdx = 0; branchIdx < (config.branches?.length || 0); branchIdx++) {
      const branch = config.branches[branchIdx];

      for (const slot of branch.timeSlots || []) {
        // Determine which days this slot applies to
        let applicableDays: number[];
        if (typeof slot.days === 'string') {
          switch (slot.days) {
            case 'weekdays': applicableDays = weekdays; break;
            case 'weekends': applicableDays = weekends; break;
            case 'everyday': applicableDays = everyday; break;
            default: applicableDays = [];
          }
        } else {
          applicableDays = slot.days || [];
        }

        // Check if today is in the applicable days
        if (!applicableDays.includes(dayOfWeek)) {
          continue;
        }

        // Check time - if allDay, it matches
        if (slot.allDay) {
          return branchIdx;
        }

        // Check time range
        if (slot.startTime && slot.endTime) {
          const [startHour, startMin] = slot.startTime.split(':').map(Number);
          const [endHour, endMin] = slot.endTime.split(':').map(Number);

          const startTime = startHour * 60 + startMin;
          const endTime = endHour * 60 + endMin;

          if (currentTime >= startTime && currentTime < endTime) {
            return branchIdx;
          }
        }
      }
    }

    // No branch matched - use fallback
    return -1;
  }

  /**
   * Process a keypad entry step
   */
  private processKeypadEntry(
    response: twilio.twiml.VoiceResponse,
    config: KeypadEntryStepConfig,
    context: CallContext,
    stepIndex: number,
  ): void {
    const gather = response.gather({
      input: ['dtmf'],
      numDigits: config.maxDigits || 10,
      timeout: config.timeout || 5,
      finishOnKey: config.finishOnKey !== false ? '#' : '',
      action: this.buildFlowUrl(context.tenantId, context.phoneNumberId, stepIndex, {
        action: 'keypad',
        var: config.variableName || 'keypad_input',
      }),
      method: 'POST',
    });

    // Add prompt message
    if (config.message.type === MessageType.RECORDING && config.message.recordingUrl) {
      gather.play(config.message.recordingUrl);
    } else if (config.message.type === MessageType.TTS) {
      // Prefer pre-generated audio URL (from OpenAI TTS)
      if (config.message.generatedAudioUrl) {
        gather.play(config.message.generatedAudioUrl);
      } else if (config.message.text) {
        // Fall back to Twilio's native TTS
        gather.say(
          {
            voice: 'alice' as any,
            language: config.message.language || 'en-US',
          },
          config.message.text,
        );
      }
    }

    // If no input, continue to next step
    response.redirect(
      { method: 'POST' },
      this.buildFlowUrl(context.tenantId, context.phoneNumberId, stepIndex + 1),
    );
  }

  /**
   * Process a voicemail step (TERMINAL)
   */
  private processVoicemail(
    response: twilio.twiml.VoiceResponse,
    config: VoicemailStepConfig,
    context: CallContext,
  ): void {
    // Play greeting
    if (config.greeting) {
      this.addMessage(response, config.greeting);
    } else {
      response.say(
        { voice: 'alice' as any },
        'Please leave a message after the beep.',
      );
    }

    // Record voicemail with 20-second limit to prevent bot spam
    response.record({
      maxLength: config.maxLength || 20, // Default 20 seconds to prevent bots
      timeout: 3, // End recording after 3 seconds of silence
      transcribe: config.transcribe !== false,
      transcribeCallback: `${this.baseUrl}/api/v1/twilio/voice/transcription/${context.tenantId}/${context.callSid}`,
      action: `${this.baseUrl}/api/v1/twilio/voice/voicemail/${context.tenantId}/${context.callSid}`,
      method: 'POST',
      playBeep: true,
      finishOnKey: '#', // Allow caller to press # to finish early
    });

    response.hangup();
  }

  /**
   * Process a hangup step (TERMINAL)
   */
  private processHangup(
    response: twilio.twiml.VoiceResponse,
    config: HangupStepConfig,
  ): void {
    if (config.message) {
      this.addMessage(response, config.message);
    }
    response.hangup();
  }

  /**
   * Execute a single step and return TwiML
   */
  async executeStep(
    steps: CallFlowStep[],
    stepIndex: number,
    context: CallContext,
    webhookParams: Record<string, string> = {},
  ): Promise<string> {
    const response = new VoiceResponse();

    if (stepIndex >= steps.length) {
      // No more steps, hangup
      response.say({ voice: 'alice' as any }, 'Goodbye.');
      response.hangup();
      return response.toString();
    }

    const step = steps[stepIndex];
    this.logger.debug(`Executing step ${stepIndex}: ${step.type} (${step.id})`);

    switch (step.type) {
      case CallFlowStepType.GREETING: {
        this.processGreeting(response, step.config as GreetingStepConfig);
        // Continue to next step
        response.redirect(
          { method: 'POST' },
          this.buildFlowUrl(context.tenantId, context.phoneNumberId, stepIndex + 1),
        );
        break;
      }

      case CallFlowStepType.DIAL: {
        await this.processDial(response, step.config as DialStepConfig, context, stepIndex);
        break;
      }

      case CallFlowStepType.SIMULCALL: {
        await this.processSimulcall(response, step.config as SimulcallStepConfig, context, stepIndex);
        break;
      }

      case CallFlowStepType.ROUND_ROBIN: {
        const attempt = parseInt(webhookParams.attempt || '0', 10);
        await this.processRoundRobin(
          response,
          step.config as RoundRobinStepConfig,
          context,
          stepIndex,
          attempt,
        );
        break;
      }

      case CallFlowStepType.MENU: {
        this.processMenu(response, step.config as MenuStepConfig, context, stepIndex);
        break;
      }

      case CallFlowStepType.SCHEDULE: {
        const config = step.config as ScheduleStepConfig;
        const matchingBranchIdx = this.findMatchingScheduleBranch(config);

        // Determine which steps to execute
        let branchSteps: CallFlowStep[] | undefined;
        if (matchingBranchIdx >= 0 && config.branches?.[matchingBranchIdx]) {
          branchSteps = config.branches[matchingBranchIdx].steps;
        } else {
          // No branch matched - use fallback steps
          branchSteps = config.fallbackSteps;
        }

        if (branchSteps && branchSteps.length > 0) {
          // Execute first step of the branch
          return this.executeNestedSteps(branchSteps, 0, context);
        } else {
          // No branch steps, continue to next main step
          response.redirect(
            { method: 'POST' },
            this.buildFlowUrl(context.tenantId, context.phoneNumberId, stepIndex + 1),
          );
        }
        break;
      }

      case CallFlowStepType.KEYPAD_ENTRY: {
        this.processKeypadEntry(response, step.config as KeypadEntryStepConfig, context, stepIndex);
        break;
      }

      case CallFlowStepType.TAG: {
        const config = step.config as TagStepConfig;
        context.tags.push(config.tagName);
        // TODO: Store tag in call record
        // Continue to next step immediately
        response.redirect(
          { method: 'POST' },
          this.buildFlowUrl(context.tenantId, context.phoneNumberId, stepIndex + 1),
        );
        break;
      }

      case CallFlowStepType.VOICEMAIL: {
        this.processVoicemail(response, step.config as VoicemailStepConfig, context);
        break;
      }

      case CallFlowStepType.HANGUP: {
        this.processHangup(response, step.config as HangupStepConfig);
        break;
      }

      default:
        this.logger.warn(`Unknown step type: ${step.type}`);
        response.redirect(
          { method: 'POST' },
          this.buildFlowUrl(context.tenantId, context.phoneNumberId, stepIndex + 1),
        );
    }

    return response.toString();
  }

  /**
   * Generate a simple hangup TwiML
   */
  generateHangupTwiml(): string {
    const response = new VoiceResponse();
    response.hangup();
    return response.toString();
  }

  /**
   * Execute nested steps (for branches in menu/schedule)
   * For simple steps (greeting, hangup, voicemail), we inline the TwiML
   * For dial steps, we use the conference mechanism with callback URLs
   */
  async executeNestedSteps(
    steps: CallFlowStep[],
    stepIndex: number,
    context: CallContext,
  ): Promise<string> {
    const response = new VoiceResponse();

    if (stepIndex >= steps.length) {
      response.hangup();
      return response.toString();
    }

    const step = steps[stepIndex];

    switch (step.type) {
      case CallFlowStepType.GREETING: {
        this.processGreeting(response, step.config as GreetingStepConfig);
        // For nested, we need to continue inline
        const remainingTwiml = await this.executeNestedSteps(steps, stepIndex + 1, context);
        return response.toString().replace('</Response>', '') +
               remainingTwiml.replace('<?xml version="1.0" encoding="UTF-8"?>', '').replace('<Response>', '');
      }

      case CallFlowStepType.VOICEMAIL: {
        this.processVoicemail(response, step.config as VoicemailStepConfig, context);
        break;
      }

      case CallFlowStepType.HANGUP: {
        this.processHangup(response, step.config as HangupStepConfig);
        break;
      }

      case CallFlowStepType.DIAL: {
        // For nested DIAL, use conference mechanism
        // Store remaining steps in metadata for fallback handling
        const remainingSteps = steps.slice(stepIndex + 1);
        await this.storeNestedFlowContext(context, remainingSteps);
        await this.processNestedDial(response, step.config as DialStepConfig, context);
        break;
      }

      case CallFlowStepType.SIMULCALL: {
        // For nested SIMULCALL, use conference mechanism
        const remainingSteps = steps.slice(stepIndex + 1);
        await this.storeNestedFlowContext(context, remainingSteps);
        await this.processNestedSimulcall(response, step.config as SimulcallStepConfig, context);
        break;
      }

      case CallFlowStepType.ROUND_ROBIN: {
        // For nested ROUND_ROBIN, use conference mechanism
        const remainingSteps = steps.slice(stepIndex + 1);
        await this.storeNestedFlowContext(context, remainingSteps);
        await this.processNestedRoundRobin(response, step.config as RoundRobinStepConfig, context, 0);
        break;
      }

      default:
        this.logger.warn(`Nested step type ${step.type} not fully supported yet`);
        response.hangup();
    }

    return response.toString();
  }

  /**
   * Store nested flow context in call metadata for callback handling
   */
  private async storeNestedFlowContext(
    context: CallContext,
    remainingSteps: CallFlowStep[],
  ): Promise<void> {
    try {
      const call = await this.prisma.phoneCall.findFirst({
        where: { twilioCallSid: context.callSid },
      });

      if (call) {
        const metaValue = (call.metaValue as any) || {};
        await this.prisma.phoneCall.update({
          where: { id: call.id },
          data: {
            metaValue: {
              ...metaValue,
              nestedFlowSteps: remainingSteps,
              isNestedFlow: true,
            },
          },
        });
        this.logger.log(`Stored nested flow context with ${remainingSteps.length} remaining steps`);
      }
    } catch (error) {
      this.logger.error(`Failed to store nested flow context: ${error.message}`);
    }
  }

  /**
   * Process a dial step within a nested flow (menu option or schedule branch)
   */
  private async processNestedDial(
    response: twilio.twiml.VoiceResponse,
    config: DialStepConfig,
    context: CallContext,
  ): Promise<void> {
    const shouldRecord = config.record || context.recordCalls;
    const segmentNumber = context.segmentNumber || 0;
    const conferenceName = generateConferenceName(context.callSid, segmentNumber);

    this.logger.log(`processNestedDial - destination: "${config.destination}", conference: ${conferenceName}`);

    const conferenceOptions: any = {
      startConferenceOnEnter: true,
      endConferenceOnExit: true,
      beep: false,
      waitUrl: `${this.baseUrl}/api/v1/twilio/voice/ring`,
      waitMethod: 'GET',
      statusCallback: `${this.baseUrl}/api/v1/twilio/voice/conference/${context.tenantId}/${context.callSid}/${segmentNumber}`,
      statusCallbackEvent: ['start', 'end', 'join', 'leave'],
      statusCallbackMethod: 'POST',
    };

    if (shouldRecord) {
      conferenceOptions.record = 'record-from-start';
      conferenceOptions.recordingStatusCallback = `${this.baseUrl}/api/v1/twilio/voice/recording/${context.tenantId}/${context.callSid}/${segmentNumber}`;
      conferenceOptions.recordingStatusCallbackMethod = 'POST';
    }

    // For nested flows, use a special dial-status URL that indicates nested context
    const dialOptions: any = {
      timeout: config.timeout || 30,
      action: `${this.baseUrl}/api/v1/twilio/voice/flow/${context.tenantId}/${context.phoneNumberId}/nested-dial-status`,
      method: 'POST',
    };

    const dial = response.dial(dialOptions);
    dial.conference(conferenceOptions, conferenceName);

    // Store target for conference callback to dial
    await this.storeConferenceTarget(context, conferenceName, config.destination, segmentNumber, undefined, undefined, config.timeout);
  }

  /**
   * Process a simulcall step within a nested flow
   */
  private async processNestedSimulcall(
    response: twilio.twiml.VoiceResponse,
    config: SimulcallStepConfig,
    context: CallContext,
  ): Promise<void> {
    const shouldRecord = context.recordCalls;
    const segmentNumber = context.segmentNumber || 0;
    const conferenceName = generateConferenceName(context.callSid, segmentNumber);

    this.logger.log(`processNestedSimulcall - destinations: ${config.destinations.join(', ')}`);

    const conferenceOptions: any = {
      startConferenceOnEnter: true,
      endConferenceOnExit: true,
      beep: false,
      waitUrl: `${this.baseUrl}/api/v1/twilio/voice/ring`,
      waitMethod: 'GET',
      statusCallback: `${this.baseUrl}/api/v1/twilio/voice/conference/${context.tenantId}/${context.callSid}/${segmentNumber}`,
      statusCallbackEvent: ['start', 'end', 'join', 'leave'],
      statusCallbackMethod: 'POST',
    };

    if (shouldRecord) {
      conferenceOptions.record = 'record-from-start';
      conferenceOptions.recordingStatusCallback = `${this.baseUrl}/api/v1/twilio/voice/recording/${context.tenantId}/${context.callSid}/${segmentNumber}`;
      conferenceOptions.recordingStatusCallbackMethod = 'POST';
    }

    const dialOptions: any = {
      timeout: config.timeout || 30,
      action: `${this.baseUrl}/api/v1/twilio/voice/flow/${context.tenantId}/${context.phoneNumberId}/nested-dial-status`,
      method: 'POST',
    };

    const dial = response.dial(dialOptions);
    dial.conference(conferenceOptions, conferenceName);

    await this.storeConferenceTarget(context, conferenceName, config.destinations.join(','), segmentNumber, undefined, undefined, config.timeout);
  }

  /**
   * Process a round robin step within a nested flow
   */
  private async processNestedRoundRobin(
    response: twilio.twiml.VoiceResponse,
    config: RoundRobinStepConfig,
    context: CallContext,
    attemptIndex: number,
  ): Promise<void> {
    if (attemptIndex >= config.destinations.length) {
      // All destinations tried, execute remaining nested steps or hangup
      const call = await this.prisma.phoneCall.findFirst({
        where: { twilioCallSid: context.callSid },
      });
      const metaValue = (call?.metaValue as any) || {};
      const remainingSteps = metaValue.nestedFlowSteps as CallFlowStep[] | undefined;

      if (remainingSteps?.length) {
        // Return early - let executeNestedSteps handle remaining steps
        // This case shouldn't normally happen as attemptIndex starts at 0
        response.hangup();
        return;
      }
      response.hangup();
      return;
    }

    const destination = config.destinations[attemptIndex];
    const shouldRecord = context.recordCalls;
    const segmentNumber = context.segmentNumber || 0;
    const conferenceName = generateConferenceName(context.callSid, segmentNumber);

    this.logger.log(`processNestedRoundRobin - attempt ${attemptIndex + 1}/${config.destinations.length}, destination: ${destination}`);

    const conferenceOptions: any = {
      startConferenceOnEnter: true,
      endConferenceOnExit: true,
      beep: false,
      waitUrl: `${this.baseUrl}/api/v1/twilio/voice/ring`,
      waitMethod: 'GET',
      statusCallback: `${this.baseUrl}/api/v1/twilio/voice/conference/${context.tenantId}/${context.callSid}/${segmentNumber}`,
      statusCallbackEvent: ['start', 'end', 'join', 'leave'],
      statusCallbackMethod: 'POST',
    };

    if (shouldRecord) {
      conferenceOptions.record = 'record-from-start';
      conferenceOptions.recordingStatusCallback = `${this.baseUrl}/api/v1/twilio/voice/recording/${context.tenantId}/${context.callSid}/${segmentNumber}`;
      conferenceOptions.recordingStatusCallbackMethod = 'POST';
    }

    // Store round robin config for retry handling
    await this.storeNestedRoundRobinContext(context, config.destinations, attemptIndex);

    const dialOptions: any = {
      timeout: config.timeoutPerDestination || 20,
      action: `${this.baseUrl}/api/v1/twilio/voice/flow/${context.tenantId}/${context.phoneNumberId}/nested-dial-status?rrAttempt=${attemptIndex}`,
      method: 'POST',
    };

    const dial = response.dial(dialOptions);
    dial.conference(conferenceOptions, conferenceName);

    await this.storeConferenceTarget(context, conferenceName, destination, segmentNumber, undefined, attemptIndex, config.timeoutPerDestination);
  }

  /**
   * Store round robin context for nested flows
   */
  private async storeNestedRoundRobinContext(
    context: CallContext,
    destinations: string[],
    currentAttempt: number,
  ): Promise<void> {
    try {
      const call = await this.prisma.phoneCall.findFirst({
        where: { twilioCallSid: context.callSid },
      });

      if (call) {
        const metaValue = (call.metaValue as any) || {};
        await this.prisma.phoneCall.update({
          where: { id: call.id },
          data: {
            metaValue: {
              ...metaValue,
              nestedRoundRobin: {
                destinations,
                currentAttempt,
                timeoutPerDestination: 20, // Default
              },
            },
          },
        });
      }
    } catch (error) {
      this.logger.error(`Failed to store nested round robin context: ${error.message}`);
    }
  }

  /**
   * Handle nested dial status (when dial in nested flow completes)
   */
  async handleNestedDialStatus(
    callSid: string,
    context: CallContext,
    callWasAnswered: boolean,
    rrAttempt?: number,
  ): Promise<string> {
    const response = new VoiceResponse();

    // If call was answered, just hangup (call is done)
    if (callWasAnswered) {
      response.hangup();
      return response.toString();
    }

    // Call wasn't answered - check for round robin retry or remaining nested steps
    const call = await this.prisma.phoneCall.findFirst({
      where: { twilioCallSid: callSid },
    });

    if (!call) {
      response.hangup();
      return response.toString();
    }

    const metaValue = (call.metaValue as any) || {};

    // Check if this is a round robin with more attempts
    if (rrAttempt !== undefined && metaValue.nestedRoundRobin) {
      const { destinations, timeoutPerDestination } = metaValue.nestedRoundRobin;
      const nextAttempt = rrAttempt + 1;

      if (nextAttempt < destinations.length) {
        // Try next destination
        this.logger.log(`Nested round robin: trying next destination (attempt ${nextAttempt + 1}/${destinations.length})`);
        return this.processNestedRoundRobinRetry(
          context,
          destinations,
          nextAttempt,
          timeoutPerDestination,
        );
      }
    }

    // No more round robin attempts - check for remaining nested steps
    const remainingSteps = metaValue.nestedFlowSteps as CallFlowStep[] | undefined;

    if (remainingSteps?.length) {
      this.logger.log(`Executing ${remainingSteps.length} remaining nested steps`);
      return this.executeNestedSteps(remainingSteps, 0, context);
    }

    // Nothing left to do - hangup
    response.hangup();
    return response.toString();
  }

  /**
   * Process a round robin retry in nested flow
   */
  private async processNestedRoundRobinRetry(
    context: CallContext,
    destinations: string[],
    attemptIndex: number,
    timeoutPerDestination: number,
  ): Promise<string> {
    const response = new VoiceResponse();
    const destination = destinations[attemptIndex];
    const segmentNumber = context.segmentNumber || 0;
    const conferenceName = generateConferenceName(context.callSid, segmentNumber);

    this.logger.log(`processNestedRoundRobinRetry - attempt ${attemptIndex + 1}/${destinations.length}, destination: ${destination}`);

    const conferenceOptions: any = {
      startConferenceOnEnter: true,
      endConferenceOnExit: true,
      beep: false,
      waitUrl: `${this.baseUrl}/api/v1/twilio/voice/ring`,
      waitMethod: 'GET',
      statusCallback: `${this.baseUrl}/api/v1/twilio/voice/conference/${context.tenantId}/${context.callSid}/${segmentNumber}`,
      statusCallbackEvent: ['start', 'end', 'join', 'leave'],
      statusCallbackMethod: 'POST',
    };

    if (context.recordCalls) {
      conferenceOptions.record = 'record-from-start';
      conferenceOptions.recordingStatusCallback = `${this.baseUrl}/api/v1/twilio/voice/recording/${context.tenantId}/${context.callSid}/${segmentNumber}`;
      conferenceOptions.recordingStatusCallbackMethod = 'POST';
    }

    // Update round robin context
    await this.storeNestedRoundRobinContext(context, destinations, attemptIndex);

    const dialOptions: any = {
      timeout: timeoutPerDestination,
      action: `${this.baseUrl}/api/v1/twilio/voice/flow/${context.tenantId}/${context.phoneNumberId}/nested-dial-status?rrAttempt=${attemptIndex}`,
      method: 'POST',
    };

    const dial = response.dial(dialOptions);
    dial.conference(conferenceOptions, conferenceName);

    await this.storeConferenceTarget(context, conferenceName, destination, segmentNumber, undefined, attemptIndex, timeoutPerDestination);

    return response.toString();
  }

  /**
   * Handle menu digit selection
   */
  async handleMenuSelection(
    steps: CallFlowStep[],
    stepIndex: number,
    digit: string,
    context: CallContext,
  ): Promise<string> {
    const step = steps[stepIndex];
    if (step.type !== CallFlowStepType.MENU) {
      return this.executeStep(steps, stepIndex + 1, context);
    }

    const config = step.config as MenuStepConfig;
    const selectedOption = config.options.find(o => o.digit === digit);

    if (!selectedOption) {
      // Invalid option - go to invalid input steps or hangup
      if (config.invalidInputSteps?.length) {
        return this.executeNestedSteps(config.invalidInputSteps, 0, context);
      }
      // No invalid input steps defined (Do nothing) = hangup
      return this.generateHangupTwiml();
    }

    // Execute the selected option's steps
    if (selectedOption.steps?.length) {
      return this.executeNestedSteps(selectedOption.steps, 0, context);
    }

    // No steps for this option, continue to next main step
    return this.executeStep(steps, stepIndex + 1, context);
  }

  /**
   * Handle dial status callback (when dial completes)
   */
  async handleDialStatus(
    steps: CallFlowStep[],
    stepIndex: number,
    dialCallStatus: string,
    context: CallContext,
  ): Promise<string> {
    // If call was answered (completed), we're done
    if (dialCallStatus === 'completed') {
      const response = new VoiceResponse();
      response.hangup();
      return response.toString();
    }

    // Call was not answered, continue to next step
    return this.executeStep(steps, stepIndex + 1, context);
  }

  /**
   * Generate default TwiML when no call flow is configured
   */
  generateDefaultTwiml(tenantId: string): string {
    const response = new VoiceResponse();
    response.say(
      { voice: 'alice' as any },
      'Thank you for calling. We are currently unavailable. Please try again later.',
    );
    response.hangup();
    return response.toString();
  }

  /**
   * Start executing a call flow from the beginning
   */
  async startCallFlow(
    steps: CallFlowStep[],
    context: CallContext,
  ): Promise<string> {
    if (!steps || steps.length === 0) {
      return this.generateDefaultTwiml(context.tenantId);
    }

    // Start with first step
    // Recording is handled at the Dial step level via context.recordCalls
    return this.executeStep(steps, 0, context);
  }

  /**
   * Generate TwiML for an agent to join a conference
   * This is used when dialing agents into an existing conference
   */
  generateJoinConferenceTwiml(
    conferenceName: string,
    options: {
      endConferenceOnExit?: boolean;
      muted?: boolean;
      startConferenceOnEnter?: boolean;
    } = {},
  ): string {
    const response = new VoiceResponse();
    const dial = response.dial();

    dial.conference(
      {
        startConferenceOnEnter: options.startConferenceOnEnter ?? true,
        endConferenceOnExit: options.endConferenceOnExit ?? false, // Agent leaving doesn't end conference by default
        muted: options.muted ?? false,
        beep: 'false' as const,
      },
      conferenceName,
    );

    return response.toString();
  }

  /**
   * Generate TwiML for transferring caller to a new conference
   * Used when transferring a call to a new agent
   */
  generateTransferToConferenceTwiml(
    conferenceName: string,
    tenantId: string,
    callSid: string,
    segmentNumber: number,
    shouldRecord: boolean,
  ): string {
    const response = new VoiceResponse();

    const conferenceOptions: any = {
      startConferenceOnEnter: true,
      endConferenceOnExit: true,
      beep: false,
      waitUrl: '',
      statusCallback: `${this.baseUrl}/api/v1/twilio/voice/conference/${tenantId}/${callSid}/${segmentNumber}`,
      statusCallbackEvent: ['start', 'end', 'join', 'leave'],
      statusCallbackMethod: 'POST',
    };

    if (shouldRecord) {
      conferenceOptions.record = 'record-from-start';
      conferenceOptions.recordingStatusCallback = `${this.baseUrl}/api/v1/twilio/voice/recording/${tenantId}/${callSid}/${segmentNumber}`;
      conferenceOptions.recordingStatusCallbackMethod = 'POST';
    }

    const dial = response.dial();
    dial.conference(conferenceOptions, conferenceName);

    return response.toString();
  }
}
