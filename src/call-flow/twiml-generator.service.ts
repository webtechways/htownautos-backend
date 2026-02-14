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
   * Process a dial step - ring one number
   */
  private processDial(
    response: twilio.twiml.VoiceResponse,
    config: DialStepConfig,
    context: CallContext,
    stepIndex: number,
  ): void {
    const dial = response.dial({
      timeout: config.timeout || 30,
      callerId: config.callerId || context.to,
      action: this.buildDialStatusUrl(context.tenantId, context.phoneNumberId, stepIndex),
      method: 'POST',
      ...(config.record && { record: 'record-from-answer-dual' }),
    });

    if (config.isExtension) {
      // Dial by extension - look up user's phone number
      // For now, treat extension as direct number
      dial.number(config.destination);
    } else {
      dial.number(config.destination);
    }
  }

  /**
   * Process a simulcall step - ring multiple numbers simultaneously
   */
  private processSimulcall(
    response: twilio.twiml.VoiceResponse,
    config: SimulcallStepConfig,
    context: CallContext,
    stepIndex: number,
  ): void {
    const dial = response.dial({
      timeout: config.timeout || 30,
      callerId: config.callerId || context.to,
      action: this.buildDialStatusUrl(context.tenantId, context.phoneNumberId, stepIndex),
      method: 'POST',
    });

    // Add all destinations - they will ring simultaneously
    for (const destination of config.destinations) {
      dial.number(destination);
    }
  }

  /**
   * Process a round robin step - handled specially with sequential callbacks
   */
  private processRoundRobin(
    response: twilio.twiml.VoiceResponse,
    config: RoundRobinStepConfig,
    context: CallContext,
    stepIndex: number,
    attemptIndex = 0,
  ): void {
    if (attemptIndex >= config.destinations.length) {
      // All numbers tried, continue to next step
      response.redirect(
        { method: 'POST' },
        this.buildFlowUrl(context.tenantId, context.phoneNumberId, stepIndex + 1),
      );
      return;
    }

    const dial = response.dial({
      timeout: config.timeoutPerDestination || 20,
      callerId: config.callerId || context.to,
      action: this.buildFlowUrl(context.tenantId, context.phoneNumberId, stepIndex, {
        action: 'round_robin',
        attempt: (attemptIndex + 1).toString(),
      }),
      method: 'POST',
    });

    dial.number(config.destinations[attemptIndex]);
  }

  /**
   * Process a menu step - IVR with options
   */
  private processMenu(
    response: twilio.twiml.VoiceResponse,
    config: MenuStepConfig,
    context: CallContext,
    stepIndex: number,
    retryCount = 0,
  ): void {
    const gather = response.gather({
      input: ['dtmf'],
      numDigits: config.numDigits || 1,
      timeout: config.timeout || 5,
      action: this.buildFlowUrl(context.tenantId, context.phoneNumberId, stepIndex, {
        action: 'menu',
      }),
      method: 'POST',
    });

    // Add the prompt message inside gather
    if (config.message.type === MessageType.RECORDING && config.message.recordingUrl) {
      gather.play(config.message.recordingUrl);
    } else if (config.message.type === MessageType.TTS && config.message.text) {
      gather.say(
        {
          voice: 'alice' as any,
          language: config.message.language || 'en-US',
        },
        config.message.text,
      );
    }

    // If no input, handle retry or invalid input steps
    const maxRetries = config.retries ?? 2;
    if (retryCount < maxRetries) {
      response.redirect(
        { method: 'POST' },
        this.buildFlowUrl(context.tenantId, context.phoneNumberId, stepIndex, {
          action: 'menu_retry',
          retry: (retryCount + 1).toString(),
        }),
      );
    } else {
      // Max retries reached, go to invalid input steps or next step
      response.redirect(
        { method: 'POST' },
        this.buildFlowUrl(context.tenantId, context.phoneNumberId, stepIndex, {
          action: 'menu_invalid',
        }),
      );
    }
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
    } else if (config.message.type === MessageType.TTS && config.message.text) {
      gather.say(
        {
          voice: 'alice' as any,
          language: config.message.language || 'en-US',
        },
        config.message.text,
      );
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

    // Record voicemail
    response.record({
      maxLength: config.maxLength || 120,
      transcribe: config.transcribe !== false,
      transcribeCallback: `${this.baseUrl}/api/v1/twilio/voice/transcription/${context.tenantId}/${context.callSid}`,
      action: `${this.baseUrl}/api/v1/twilio/voice/voicemail/${context.tenantId}/${context.callSid}`,
      method: 'POST',
      playBeep: true,
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
        this.processDial(response, step.config as DialStepConfig, context, stepIndex);
        break;
      }

      case CallFlowStepType.SIMULCALL: {
        this.processSimulcall(response, step.config as SimulcallStepConfig, context, stepIndex);
        break;
      }

      case CallFlowStepType.ROUND_ROBIN: {
        const attempt = parseInt(webhookParams.attempt || '0', 10);
        this.processRoundRobin(
          response,
          step.config as RoundRobinStepConfig,
          context,
          stepIndex,
          attempt,
        );
        break;
      }

      case CallFlowStepType.MENU: {
        const retry = parseInt(webhookParams.retry || '0', 10);
        this.processMenu(response, step.config as MenuStepConfig, context, stepIndex, retry);
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
   * Execute nested steps (for branches in menu/schedule)
   */
  private async executeNestedSteps(
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

    // For nested steps, we inline the TwiML generation
    // This is simpler than creating callback URLs for nested flows
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

      // For other step types in nested flows, we'd need more complex handling
      default:
        this.logger.warn(`Nested step type ${step.type} not fully supported yet`);
        response.hangup();
    }

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
      // Invalid option, handle as invalid input
      if (config.invalidInputSteps?.length) {
        return this.executeNestedSteps(config.invalidInputSteps, 0, context);
      }
      // Replay menu
      return this.executeStep(steps, stepIndex, context, { retry: '1' });
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
    recordCall: boolean,
  ): Promise<string> {
    const response = new VoiceResponse();

    if (recordCall) {
      // Start recording the entire call
      response.record({
        recordingStatusCallback: `${this.baseUrl}/api/v1/twilio/voice/recording/${context.tenantId}/${context.callSid}`,
        recordingStatusCallbackMethod: 'POST',
      });
    }

    if (!steps || steps.length === 0) {
      return this.generateDefaultTwiml(context.tenantId);
    }

    // Start with first step
    return this.executeStep(steps, 0, context);
  }
}
