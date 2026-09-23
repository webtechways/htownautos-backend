import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

const EVENT_TYPES = ['view', 'click'] as const;

/** Verbatim shape of contract.ts `StartPageEventRequest`. */
export class StartPageEventDto {
  @ApiPropertyOptional({ enum: EVENT_TYPES })
  @IsIn(EVENT_TYPES)
  type!: (typeof EVENT_TYPES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  blockId?: string;
}
