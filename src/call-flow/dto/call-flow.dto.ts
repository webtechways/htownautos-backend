import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  IsEnum,
  IsUUID,
  ValidateNested,
  IsNumber,
  Min,
  Max,
  Matches,
  ArrayMinSize,
  IsObject,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';

// ============================================
// STEP TYPES
// ============================================
export enum CallFlowStepType {
  GREETING = 'greeting',
  DIAL = 'dial',
  SIMULCALL = 'simulcall',
  ROUND_ROBIN = 'round_robin',
  MENU = 'menu',
  SCHEDULE = 'schedule',
  KEYPAD_ENTRY = 'keypad_entry',
  TAG = 'tag',
  VOICEMAIL = 'voicemail',
  HANGUP = 'hangup',
}

// Terminal steps - nothing can follow these
export const TERMINAL_STEP_TYPES = [
  CallFlowStepType.VOICEMAIL,
  CallFlowStepType.HANGUP,
];

// ============================================
// MESSAGE CONFIGURATION (TTS or Recording)
// ============================================
export enum MessageType {
  TTS = 'tts',
  RECORDING = 'recording',
}

// OpenAI TTS voices (gpt-4o-mini-tts model)
export enum TtsVoice {
  ALLOY = 'alloy',
  ASH = 'ash',
  BALLAD = 'ballad',
  CEDAR = 'cedar',
  CORAL = 'coral',
  ECHO = 'echo',
  FABLE = 'fable',
  MARIN = 'marin',
  NOVA = 'nova',
  ONYX = 'onyx',
  SAGE = 'sage',
  SHIMMER = 'shimmer',
}

export enum TtsLanguage {
  EN_US = 'en-US',
  EN_GB = 'en-GB',
  ES_ES = 'es-ES',
  ES_MX = 'es-MX',
  FR_FR = 'fr-FR',
}

export class MessageConfig {
  @ApiProperty({ enum: MessageType })
  @IsEnum(MessageType)
  type: MessageType;

  @ApiPropertyOptional({ description: 'Text to speak (for TTS)' })
  @IsOptional()
  @IsString()
  text?: string;

  @ApiPropertyOptional({ description: 'URL to audio recording' })
  @IsOptional()
  @IsString()
  recordingUrl?: string;

  @ApiPropertyOptional({ enum: TtsVoice, default: TtsVoice.ECHO })
  @IsOptional()
  @IsEnum(TtsVoice)
  voice?: TtsVoice;

  @ApiPropertyOptional({ enum: TtsLanguage, default: TtsLanguage.EN_US })
  @IsOptional()
  @IsEnum(TtsLanguage)
  language?: TtsLanguage;

  @ApiPropertyOptional({ description: 'Cached TTS audio URL (generated from text+voice)' })
  @IsOptional()
  @IsString()
  generatedAudioUrl?: string;
}

// ============================================
// STEP CONFIGURATIONS
// ============================================

// Greeting Step - Play message, then continue to next step
export class GreetingStepConfig {
  @ApiProperty({ type: MessageConfig })
  @ValidateNested()
  @Type(() => MessageConfig)
  message: MessageConfig;
}

// Dial Step - Ring one number
export class DialStepConfig {
  @ApiProperty({ description: 'Phone number or extension to dial' })
  @IsString()
  destination: string;

  @ApiPropertyOptional({ description: 'Is this an extension (true) or phone number (false)' })
  @IsOptional()
  @IsBoolean()
  isExtension?: boolean;

  @ApiPropertyOptional({ description: 'Timeout in seconds', default: 30 })
  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(120)
  timeout?: number;

  @ApiPropertyOptional({ description: 'Caller ID to display' })
  @IsOptional()
  @IsString()
  callerId?: string;

  @ApiPropertyOptional({ description: 'Record this leg of the call' })
  @IsOptional()
  @IsBoolean()
  record?: boolean;
}

// Simulcall Step - Ring multiple numbers simultaneously
export class SimulcallStepConfig {
  @ApiProperty({ description: 'List of destinations to ring simultaneously', type: [String] })
  @IsArray()
  @ArrayMinSize(2)
  @IsString({ each: true })
  destinations: string[];

  @ApiPropertyOptional({ description: 'Timeout in seconds', default: 30 })
  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(120)
  timeout?: number;

  @ApiPropertyOptional({ description: 'Caller ID to display' })
  @IsOptional()
  @IsString()
  callerId?: string;
}

// Round Robin Step - Try numbers in order
export class RoundRobinStepConfig {
  @ApiProperty({ description: 'List of destinations to try in order', type: [String] })
  @IsArray()
  @ArrayMinSize(2)
  @IsString({ each: true })
  destinations: string[];

  @ApiPropertyOptional({ description: 'Timeout per destination in seconds', default: 20 })
  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(60)
  timeoutPerDestination?: number;

  @ApiPropertyOptional({ description: 'Caller ID to display' })
  @IsOptional()
  @IsString()
  callerId?: string;
}

// Menu Option - for IVR menu
export class MenuOption {
  @ApiProperty({ description: 'DTMF digit (1-9, 0, *, #)' })
  @IsString()
  @Matches(/^[0-9*#]$/, { message: 'Digit must be 0-9, *, or #' })
  digit: string;

  @ApiProperty({ description: 'Label for this option' })
  @IsString()
  label: string;

  @ApiPropertyOptional({ description: 'Sub-flow steps for this option', type: 'array' })
  @IsOptional()
  @IsArray()
  steps?: CallFlowStep[];
}

// Menu Step - IVR menu with options
export class MenuStepConfig {
  @ApiProperty({ type: MessageConfig, description: 'Message to play (e.g., "Press 1 for sales...")' })
  @ValidateNested()
  @Type(() => MessageConfig)
  message: MessageConfig;

  @ApiProperty({ type: [MenuOption], description: 'Menu options' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MenuOption)
  options: MenuOption[];

  @ApiPropertyOptional({ description: 'Max digits to collect', default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  numDigits?: number;

  @ApiPropertyOptional({ description: 'Timeout waiting for input in seconds', default: 5 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(30)
  timeout?: number;

  @ApiPropertyOptional({ description: 'How many times to replay menu if no input', default: 2 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  retries?: number;

  @ApiPropertyOptional({ description: 'Steps to execute if invalid/no input', type: 'array' })
  @IsOptional()
  @IsArray()
  invalidInputSteps?: CallFlowStep[];
}

// Schedule Time Slot - defines days and time range for a branch
export class ScheduleTimeSlot {
  @ApiProperty({
    description: 'Days: "weekdays", "weekends", "everyday", or array of day numbers [0-6]',
    example: 'weekdays',
  })
  days: 'weekdays' | 'weekends' | 'everyday' | number[];

  @ApiPropertyOptional({ description: 'Start time in HH:MM format (24h)', example: '09:00' })
  @IsOptional()
  @IsString()
  startTime?: string;

  @ApiPropertyOptional({ description: 'End time in HH:MM format (24h)', example: '17:00' })
  @IsOptional()
  @IsString()
  endTime?: string;

  @ApiPropertyOptional({ description: 'If true, applies to all day (no time range needed)' })
  @IsOptional()
  @IsBoolean()
  allDay?: boolean;
}

// Schedule Branch - similar to Menu Option but with time-based conditions
export class ScheduleBranch {
  @ApiProperty({ description: 'Unique branch ID' })
  @IsString()
  id: string;

  @ApiProperty({ description: 'Branch name (e.g., "Business Hours", "After Hours")' })
  @IsString()
  name: string;

  @ApiProperty({ type: [ScheduleTimeSlot], description: 'Time slots when this branch is active' })
  @IsArray()
  timeSlots: ScheduleTimeSlot[];

  @ApiPropertyOptional({ description: 'Sub-flow steps for this branch', type: 'array' })
  @IsOptional()
  @IsArray()
  steps?: CallFlowStep[];
}

// Schedule Step - Route based on time-based branches
export class ScheduleStepConfig {
  @ApiProperty({ description: 'Timezone for schedule', example: 'America/Chicago' })
  @IsString()
  timezone: string;

  @ApiProperty({ type: [ScheduleBranch], description: 'Schedule branches with time conditions' })
  @IsArray()
  branches: ScheduleBranch[];

  @ApiProperty({ description: 'Fallback steps for "Any other time"', type: 'array' })
  @IsArray()
  fallbackSteps: CallFlowStep[];
}

// Keypad Entry Step - Collect digits (e.g., account number)
export class KeypadEntryStepConfig {
  @ApiProperty({ type: MessageConfig, description: 'Prompt message' })
  @ValidateNested()
  @Type(() => MessageConfig)
  message: MessageConfig;

  @ApiPropertyOptional({ description: 'Variable name to store input', default: 'keypad_input' })
  @IsOptional()
  @IsString()
  variableName?: string;

  @ApiPropertyOptional({ description: 'Max digits to collect', default: 10 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(20)
  maxDigits?: number;

  @ApiPropertyOptional({ description: 'Min digits required', default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(20)
  minDigits?: number;

  @ApiPropertyOptional({ description: 'Finish on # key', default: true })
  @IsOptional()
  @IsBoolean()
  finishOnKey?: boolean;

  @ApiPropertyOptional({ description: 'Timeout in seconds', default: 5 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(30)
  timeout?: number;
}

// Tag Step - Add a tag to the call record
export class TagStepConfig {
  @ApiProperty({ description: 'Tag name to add to the call' })
  @IsString()
  tagName: string;

  @ApiPropertyOptional({ description: 'Tag value (optional)' })
  @IsOptional()
  @IsString()
  tagValue?: string;
}

// Voicemail Step - Send to voicemail (TERMINAL)
export class VoicemailStepConfig {
  @ApiPropertyOptional({ type: MessageConfig, description: 'Voicemail greeting' })
  @IsOptional()
  @ValidateNested()
  @Type(() => MessageConfig)
  greeting?: MessageConfig;

  @ApiPropertyOptional({ description: 'Email to send voicemail notification' })
  @IsOptional()
  @IsString()
  notificationEmail?: string;

  @ApiPropertyOptional({ description: 'Max recording length in seconds (default 20 to prevent bot spam)', default: 20 })
  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(120)
  maxLength?: number;

  @ApiPropertyOptional({ description: 'Transcribe voicemail', default: true })
  @IsOptional()
  @IsBoolean()
  transcribe?: boolean;
}

// Hangup Step - End the call (TERMINAL)
export class HangupStepConfig {
  @ApiPropertyOptional({ type: MessageConfig, description: 'Goodbye message before hanging up' })
  @IsOptional()
  @ValidateNested()
  @Type(() => MessageConfig)
  message?: MessageConfig;
}

// ============================================
// CALL FLOW STEP (Union of all step types)
// ============================================
export class CallFlowStep {
  @ApiProperty({ description: 'Unique step ID within the flow' })
  @IsString()
  id: string;

  @ApiProperty({ enum: CallFlowStepType })
  @IsEnum(CallFlowStepType)
  type: CallFlowStepType;

  @ApiPropertyOptional({ description: 'Step label/name for display' })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiProperty({ description: 'Step configuration (varies by type)' })
  @IsOptional()
  @IsObject()
  @Transform(({ value }) => value, { toClassOnly: true })
  // Note: Config validation is handled at runtime by the service
  // because class-validator doesn't support discriminated unions well
  config: Record<string, any>;
}

// ============================================
// CALL FLOW DTOs
// ============================================
export class CreateCallFlowDto {
  @ApiProperty({ description: 'Name of the call flow', example: 'Main IVR' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Description of the call flow' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Whether the flow is active', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Record all inbound calls using this flow', default: false })
  @IsOptional()
  @IsBoolean()
  recordInboundCalls?: boolean;

  @ApiPropertyOptional({ type: [CallFlowStep], description: 'Flow steps' })
  @IsOptional()
  @IsArray()
  @Type(() => CallFlowStep)
  steps?: CallFlowStep[];
}

export class UpdateCallFlowDto {
  @ApiPropertyOptional({ description: 'Name of the call flow' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Description of the call flow' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Whether the flow is active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Record all inbound calls using this flow' })
  @IsOptional()
  @IsBoolean()
  recordInboundCalls?: boolean;

  @ApiPropertyOptional({ type: [CallFlowStep], description: 'Flow steps' })
  @IsOptional()
  @IsArray()
  @Type(() => CallFlowStep)
  steps?: CallFlowStep[];
}

export class AssignCallFlowDto {
  @ApiProperty({ description: 'Call Flow ID to assign to phone number' })
  @IsUUID()
  callFlowId: string;
}

// ============================================
// RESPONSE DTOs
// ============================================
export class CallFlowResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  tenantId: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  recordInboundCalls: boolean;

  @ApiProperty({ type: [CallFlowStep] })
  steps: CallFlowStep[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional({ description: 'Number of phone numbers using this flow' })
  phoneNumberCount?: number;
}
