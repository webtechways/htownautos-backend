import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsOptional, IsInt, Min, Max, IsEnum, IsDateString, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { CallDirection, CallStatus, CallOutcome } from './create-phone-call.dto';

export class QueryPhoneCallDto {
  @ApiPropertyOptional({ description: 'Filter by buyer ID' })
  @IsUUID()
  @IsOptional()
  buyerId?: string;

  @ApiPropertyOptional({ description: 'Comma-separated list of phone numbers to search' })
  @IsString()
  @IsOptional()
  phones?: string;

  @ApiPropertyOptional({ description: 'Filter by caller (TenantUser) ID' })
  @IsUUID()
  @IsOptional()
  callerId?: string;

  @ApiPropertyOptional({ enum: CallDirection, description: 'Filter by direction' })
  @IsEnum(CallDirection)
  @IsOptional()
  direction?: CallDirection;

  @ApiPropertyOptional({ enum: CallStatus, description: 'Filter by status' })
  @IsEnum(CallStatus)
  @IsOptional()
  status?: CallStatus;

  @ApiPropertyOptional({ enum: CallOutcome, description: 'Filter by outcome' })
  @IsEnum(CallOutcome)
  @IsOptional()
  outcome?: CallOutcome;

  @ApiPropertyOptional({ description: 'Filter calls from this date' })
  @IsDateString()
  @IsOptional()
  fromDate?: string;

  @ApiPropertyOptional({ description: 'Filter calls to this date' })
  @IsDateString()
  @IsOptional()
  toDate?: string;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Sort by field', default: 'startedAt' })
  @IsOptional()
  sortBy?: string = 'startedAt';

  @ApiPropertyOptional({ description: 'Sort order', default: 'desc' })
  @IsOptional()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
