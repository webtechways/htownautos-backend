import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsUUID,
  IsEnum,
  IsDateString,
  IsInt,
  Min,
  IsBoolean,
  IsString,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { EmailDirection, EmailStatus, EmailPriority } from './create-email-message.dto';

export class QueryEmailMessageDto {
  @ApiPropertyOptional({ description: 'Filter by buyer ID' })
  @IsUUID()
  @IsOptional()
  buyerId?: string;

  @ApiPropertyOptional({ description: 'Filter by sender ID' })
  @IsUUID()
  @IsOptional()
  senderId?: string;

  @ApiPropertyOptional({ enum: EmailDirection, description: 'Filter by direction' })
  @IsEnum(EmailDirection)
  @IsOptional()
  direction?: EmailDirection;

  @ApiPropertyOptional({ enum: EmailStatus, description: 'Filter by status' })
  @IsEnum(EmailStatus)
  @IsOptional()
  status?: EmailStatus;

  @ApiPropertyOptional({ enum: EmailPriority, description: 'Filter by priority' })
  @IsEnum(EmailPriority)
  @IsOptional()
  priority?: EmailPriority;

  @ApiPropertyOptional({ description: 'Filter by read status' })
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsOptional()
  isRead?: boolean;

  @ApiPropertyOptional({ description: 'Filter by thread ID' })
  @IsString()
  @IsOptional()
  threadId?: string;

  @ApiPropertyOptional({ description: 'Search in subject' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by start date' })
  @IsDateString()
  @IsOptional()
  fromDate?: string;

  @ApiPropertyOptional({ description: 'Filter by end date' })
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
  @IsOptional()
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Sort field', default: 'createdAt' })
  @IsOptional()
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({ description: 'Sort order', enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
