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
  IsEmail,
  IsArray,
  IsBoolean,
  MaxLength,
} from 'class-validator';

export enum EmailDirection {
  INBOUND = 'inbound',
  OUTBOUND = 'outbound',
}

export enum EmailStatus {
  DRAFT = 'draft',
  QUEUED = 'queued',
  SENT = 'sent',
  DELIVERED = 'delivered',
  BOUNCED = 'bounced',
  FAILED = 'failed',
  OPENED = 'opened',
  CLICKED = 'clicked',
}

export enum EmailPriority {
  HIGH = 'high',
  NORMAL = 'normal',
  LOW = 'low',
}

export enum BounceType {
  HARD = 'hard',
  SOFT = 'soft',
  TRANSIENT = 'transient',
}

export class CreateEmailMessageDto {
  @ApiProperty({ description: 'Buyer ID' })
  @IsUUID()
  @IsNotEmpty()
  buyerId: string;

  @ApiProperty({ enum: EmailDirection, description: 'Email direction' })
  @IsEnum(EmailDirection)
  @IsNotEmpty()
  direction: EmailDirection;

  @ApiPropertyOptional({ enum: EmailStatus, description: 'Email status', default: EmailStatus.SENT })
  @IsEnum(EmailStatus)
  @IsOptional()
  status?: EmailStatus;

  @ApiProperty({ description: 'Sender email address' })
  @IsEmail()
  @IsNotEmpty()
  fromEmail: string;

  @ApiProperty({ description: 'Recipient email address' })
  @IsEmail()
  @IsNotEmpty()
  toEmail: string;

  @ApiPropertyOptional({ description: 'Reply-to address' })
  @IsEmail()
  @IsOptional()
  replyTo?: string;

  @ApiPropertyOptional({ description: 'CC email addresses', type: [String] })
  @IsArray()
  @IsOptional()
  ccEmails?: string[];

  @ApiPropertyOptional({ description: 'BCC email addresses', type: [String] })
  @IsArray()
  @IsOptional()
  bccEmails?: string[];

  @ApiProperty({ description: 'Email subject' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(998) // RFC 2822 limit
  subject: string;

  @ApiPropertyOptional({ description: 'HTML body content' })
  @IsString()
  @IsOptional()
  bodyHtml?: string;

  @ApiPropertyOptional({ description: 'Plain text body content' })
  @IsString()
  @IsOptional()
  bodyText?: string;

  @ApiPropertyOptional({ description: 'Thread ID for grouping emails' })
  @IsString()
  @IsOptional()
  threadId?: string;

  @ApiPropertyOptional({ description: 'Message-ID of email being replied to' })
  @IsString()
  @IsOptional()
  inReplyTo?: string;

  @ApiPropertyOptional({ description: 'Array of Message-IDs in thread', type: [String] })
  @IsArray()
  @IsOptional()
  references?: string[];

  @ApiPropertyOptional({ description: 'Attachment metadata array' })
  @IsArray()
  @IsOptional()
  attachments?: Array<{
    name: string;
    url: string;
    size: number;
    mimeType: string;
  }>;

  @ApiPropertyOptional({ description: 'Number of attachments', default: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  attachmentCount?: number;

  @ApiPropertyOptional({ description: 'AWS SES Message ID' })
  @IsString()
  @IsOptional()
  messageId?: string;

  @ApiPropertyOptional({ description: 'SES delivery status' })
  @IsString()
  @IsOptional()
  sesStatus?: string;

  @ApiPropertyOptional({ enum: BounceType, description: 'Bounce type if bounced' })
  @IsEnum(BounceType)
  @IsOptional()
  bounceType?: BounceType;

  @ApiPropertyOptional({ description: 'Bounce sub-type' })
  @IsString()
  @IsOptional()
  bounceSubType?: string;

  @ApiPropertyOptional({ description: 'Complaint type if complaint received' })
  @IsString()
  @IsOptional()
  complaintType?: string;

  @ApiPropertyOptional({ description: 'Has the email been read', default: false })
  @IsBoolean()
  @IsOptional()
  isRead?: boolean;

  @ApiPropertyOptional({ description: 'Number of times opened', default: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  openCount?: number;

  @ApiPropertyOptional({ description: 'Number of link clicks', default: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  clickCount?: number;

  @ApiPropertyOptional({ enum: EmailPriority, description: 'Email priority' })
  @IsEnum(EmailPriority)
  @IsOptional()
  priority?: EmailPriority;

  @ApiPropertyOptional({ description: 'Labels/tags for the email', type: [String] })
  @IsArray()
  @IsOptional()
  labels?: string[];

  @ApiPropertyOptional({ description: 'Scheduled send time' })
  @IsDateString()
  @IsOptional()
  scheduledAt?: string;

  @ApiPropertyOptional({ description: 'When the email was sent' })
  @IsDateString()
  @IsOptional()
  sentAt?: string;

  @ApiPropertyOptional({ description: 'When the email was delivered' })
  @IsDateString()
  @IsOptional()
  deliveredAt?: string;

  @ApiPropertyOptional({ description: 'When the email bounced' })
  @IsDateString()
  @IsOptional()
  bouncedAt?: string;
}

export class UpdateEmailMessageDto extends PartialType(CreateEmailMessageDto) {}
