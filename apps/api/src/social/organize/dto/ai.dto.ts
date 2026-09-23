import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PUBLISHABLE_PLATFORMS } from './platforms';

const AI_COMPOSE_ACTIONS = ['generate', 'rephrase', 'shorten', 'expand', 'fix', 'hashtags', 'translate', 'tone'] as const;
const AI_TONES = ['professional', 'friendly', 'funny', 'persuasive', 'casual'] as const;

export class AiComposeDto {
  @ApiProperty({ enum: AI_COMPOSE_ACTIONS })
  @IsIn(AI_COMPOSE_ACTIONS)
  action!: (typeof AI_COMPOSE_ACTIONS)[number];

  /** The current text — required for every action but "generate" (checked in the service). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  text?: string;

  /** What to write about — required for "generate" (checked in the service). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  prompt?: string;

  @ApiPropertyOptional({ enum: PUBLISHABLE_PLATFORMS })
  @IsOptional()
  @IsIn(PUBLISHABLE_PLATFORMS)
  platform?: (typeof PUBLISHABLE_PLATFORMS)[number];

  @ApiPropertyOptional({ enum: AI_TONES })
  @IsOptional()
  @IsIn(AI_TONES)
  tone?: (typeof AI_TONES)[number];

  /** BCP-47, e.g. "es", "en" — used by the "translate" action. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  language?: string;
}

export class AiReplyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  commentId?: string;
}
