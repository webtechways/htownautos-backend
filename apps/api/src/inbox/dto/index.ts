import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { InboxChannel } from '@htownautos/social';

export const INBOX_CHANNELS = ['sms', 'whatsapp', 'messenger', 'instagram', 'x', 'bluesky', 'mastodon'] as const satisfies readonly InboxChannel[];

export class ConversationListQueryDto {
  @ApiPropertyOptional({ enum: INBOX_CHANNELS })
  @IsOptional()
  @IsIn(INBOX_CHANNELS)
  channel?: InboxChannel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  senderId?: string;

  @ApiPropertyOptional({ enum: ['open', 'done', 'all'] })
  @IsOptional()
  @IsIn(['open', 'done', 'all'])
  status?: 'open' | 'done' | 'all';

  @ApiPropertyOptional({ description: '"me" | "unassigned" | a user id' })
  @IsOptional()
  @IsString()
  assignedTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value))
  @IsBoolean()
  unread?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class MessagePageQueryDto {
  @ApiPropertyOptional({ description: 'Message id — page of messages older than this one' })
  @IsOptional()
  @IsUUID()
  before?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class WhatsAppTemplateInputDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  language: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  variables: string[];
}

export class SendMessageDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  text?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  mediaIds?: string[];

  @ApiPropertyOptional({ type: WhatsAppTemplateInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WhatsAppTemplateInputDto)
  template?: WhatsAppTemplateInputDto;
}

export class StartConversationDto {
  @ApiProperty({ enum: ['sms', 'whatsapp'] })
  @IsIn(['sms', 'whatsapp'])
  channel: 'sms' | 'whatsapp';

  @ApiProperty({ description: 'TwilioPhoneNumber id or SocialAccount id, depending on the channel/provider' })
  @IsUUID()
  senderId: string;

  @ApiProperty({ description: 'E.164' })
  @IsString()
  @MinLength(5)
  to: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  text?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  mediaIds?: string[];

  @ApiPropertyOptional({ type: WhatsAppTemplateInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WhatsAppTemplateInputDto)
  template?: WhatsAppTemplateInputDto;
}

export class UpdateConversationDto {
  @ApiPropertyOptional({ enum: ['open', 'done'] })
  @IsOptional()
  @IsIn(['open', 'done'])
  status?: 'open' | 'done';

  @ApiPropertyOptional({ description: 'User id (UserSummary.id) — null to unassign', nullable: true })
  @IsOptional()
  @ValidateIf((o) => o.assignedToId !== null)
  @IsUUID()
  assignedToId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((o) => o.buyerId !== null)
  @IsUUID()
  buyerId?: string | null;
}
