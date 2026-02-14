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
  IsBoolean,
  IsNumber,
  MaxLength,
} from 'class-validator';

export enum SmsDirection {
  INBOUND = 'inbound',
  OUTBOUND = 'outbound',
}

export enum SmsStatus {
  QUEUED = 'queued',
  SENT = 'sent',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  RECEIVED = 'received',
  UNDELIVERED = 'undelivered',
}

export class CreateSmsDto {
  @ApiProperty({ description: 'Buyer ID' })
  @IsUUID()
  @IsNotEmpty()
  buyerId: string;

  @ApiProperty({ enum: SmsDirection, description: 'Message direction' })
  @IsEnum(SmsDirection)
  @IsNotEmpty()
  direction: SmsDirection;

  @ApiPropertyOptional({ enum: SmsStatus, description: 'Message status', default: SmsStatus.SENT })
  @IsEnum(SmsStatus)
  @IsOptional()
  status?: SmsStatus;

  @ApiProperty({ description: 'Phone number of the buyer' })
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @ApiProperty({ description: 'Sender phone number (Twilio number for outbound)' })
  @IsString()
  @IsNotEmpty()
  fromNumber: string;

  @ApiProperty({ description: 'Recipient phone number' })
  @IsString()
  @IsNotEmpty()
  toNumber: string;

  @ApiProperty({ description: 'Message content' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1600) // SMS max length with concatenation
  body: string;

  @ApiPropertyOptional({ description: 'Twilio Message SID' })
  @IsString()
  @IsOptional()
  messageSid?: string;

  @ApiPropertyOptional({ description: 'Twilio error code if failed' })
  @IsString()
  @IsOptional()
  errorCode?: string;

  @ApiPropertyOptional({ description: 'Twilio error message if failed' })
  @IsString()
  @IsOptional()
  errorMessage?: string;

  @ApiPropertyOptional({ description: 'Array of media URLs for MMS', type: [String] })
  @IsArray()
  @IsOptional()
  mediaUrls?: string[];

  @ApiPropertyOptional({ description: 'Number of media attachments', default: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  numMedia?: number;

  @ApiPropertyOptional({ description: 'Cost of the message' })
  @IsNumber()
  @IsOptional()
  price?: number;

  @ApiPropertyOptional({ description: 'Currency (e.g., USD)' })
  @IsString()
  @IsOptional()
  priceUnit?: string;

  @ApiPropertyOptional({ description: 'Number of SMS segments', default: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  segmentCount?: number;

  @ApiPropertyOptional({ description: 'Has the message been read', default: false })
  @IsBoolean()
  @IsOptional()
  isRead?: boolean;

  @ApiPropertyOptional({ description: 'When the message was sent' })
  @IsDateString()
  @IsOptional()
  sentAt?: string;

  @ApiPropertyOptional({ description: 'When the message was delivered' })
  @IsDateString()
  @IsOptional()
  deliveredAt?: string;
}

export class UpdateSmsDto extends PartialType(CreateSmsDto) {}
