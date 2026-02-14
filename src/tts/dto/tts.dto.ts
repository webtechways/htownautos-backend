import { IsString, IsEnum, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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

export class GenerateTtsDto {
  @ApiProperty({ description: 'Text to convert to speech', maxLength: 4096 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  text: string;

  @ApiProperty({ enum: TtsVoice, description: 'Voice to use for TTS' })
  @IsEnum(TtsVoice)
  voice: TtsVoice;
}

export class TtsResponseDto {
  @ApiProperty({ description: 'URL to the generated audio file' })
  audioUrl: string;

  @ApiProperty({ description: 'Whether the audio was served from cache' })
  cached: boolean;
}
