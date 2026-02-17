import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsUUID,
  IsOptional,
  IsNotEmpty,
  IsEnum,
  IsDateString,
  IsInt,
  Min,
  IsUrl,
  IsArray,
} from 'class-validator';

export enum CallDirection {
  INBOUND = 'inbound',
  OUTBOUND = 'outbound',
}

export enum CallStatus {
  COMPLETED = 'completed',
  MISSED = 'missed',
  NO_ANSWER = 'no_answer',
  BUSY = 'busy',
  VOICEMAIL = 'voicemail',
  CANCELLED = 'cancelled',
  TRANSFERRED = 'transferred',
}

export enum CallOutcome {
  INTERESTED = 'interested',
  NOT_INTERESTED = 'not_interested',
  CALLBACK_REQUESTED = 'callback_requested',
  WRONG_NUMBER = 'wrong_number',
  LEFT_VOICEMAIL = 'left_voicemail',
  APPOINTMENT_SET = 'appointment_set',
  FOLLOW_UP_NEEDED = 'follow_up_needed',
  DO_NOT_CALL = 'do_not_call',
  OTHER = 'other',
}

export enum TranscriptionStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum AiSentiment {
  POSITIVE = 'positive',
  NEUTRAL = 'neutral',
  NEGATIVE = 'negative',
}

export class CreatePhoneCallDto {
  @ApiProperty({ description: 'Buyer ID' })
  @IsUUID()
  @IsNotEmpty()
  buyerId: string;

  @ApiProperty({ enum: CallDirection, description: 'Call direction' })
  @IsEnum(CallDirection)
  @IsNotEmpty()
  direction: CallDirection;

  @ApiPropertyOptional({ enum: CallStatus, description: 'Call status', default: CallStatus.COMPLETED })
  @IsEnum(CallStatus)
  @IsOptional()
  status?: CallStatus;

  @ApiProperty({ description: 'Phone number that initiated the call' })
  @IsString()
  @IsNotEmpty()
  fromNumber: string;

  @ApiProperty({ description: 'Phone number that received the call' })
  @IsString()
  @IsNotEmpty()
  toNumber: string;

  @ApiProperty({ description: 'Call start time' })
  @IsDateString()
  @IsNotEmpty()
  startedAt: string;

  @ApiPropertyOptional({ description: 'Call end time' })
  @IsDateString()
  @IsOptional()
  endedAt?: string;

  @ApiPropertyOptional({ description: 'Call duration in seconds' })
  @IsInt()
  @Min(0)
  @IsOptional()
  duration?: number;

  @ApiPropertyOptional({ enum: CallOutcome, description: 'Call outcome' })
  @IsEnum(CallOutcome)
  @IsOptional()
  outcome?: CallOutcome;

  @ApiPropertyOptional({ description: 'Call notes/summary' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ description: 'URL to call recording' })
  @IsUrl()
  @IsOptional()
  recordingUrl?: string;

  // Transcription fields
  @ApiPropertyOptional({ description: 'Full transcription text' })
  @IsString()
  @IsOptional()
  transcription?: string;

  @ApiPropertyOptional({ enum: TranscriptionStatus, description: 'Transcription status' })
  @IsEnum(TranscriptionStatus)
  @IsOptional()
  transcriptionStatus?: TranscriptionStatus;

  // AI analysis fields
  @ApiPropertyOptional({ description: 'AI-generated summary of the call' })
  @IsString()
  @IsOptional()
  aiSummary?: string;

  @ApiPropertyOptional({ enum: AiSentiment, description: 'AI-detected sentiment' })
  @IsEnum(AiSentiment)
  @IsOptional()
  aiSentiment?: AiSentiment;

  @ApiPropertyOptional({ description: 'AI-extracted key points', type: [String] })
  @IsArray()
  @IsOptional()
  aiKeyPoints?: string[];

  @ApiPropertyOptional({ description: 'AI-suggested next steps', type: [String] })
  @IsArray()
  @IsOptional()
  aiNextSteps?: string[];
}

export class UpdatePhoneCallDto extends PartialType(CreatePhoneCallDto) {}
