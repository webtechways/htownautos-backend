import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export const EXTENSION_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export class ExtensionLogEntryDto {
  /** Epoch ms en la VM. */
  @IsInt()
  at!: number;

  @IsIn(EXTENSION_LOG_LEVELS)
  level!: (typeof EXTENSION_LOG_LEVELS)[number];

  @IsString()
  @MaxLength(60)
  event!: string;

  @IsString()
  @MaxLength(4000)
  message!: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}

/** Lo que manda la extension cada minuto: lo acumulado desde el ultimo envio. */
export class IngestLogsDto {
  @IsString()
  @MaxLength(120)
  worker!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  version?: string;

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ExtensionLogEntryDto)
  entries!: ExtensionLogEntryDto[];
}
