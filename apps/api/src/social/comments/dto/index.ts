import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';

const COMMENT_KINDS = ['comment', 'mention', 'review'] as const;
const COMMENT_STATUS_FILTER = ['open', 'done', 'all'] as const;
const COMMENT_STATUS = ['open', 'done'] as const;
const SOCIAL_PLATFORMS = ['facebook', 'instagram', 'threads', 'x', 'linkedin', 'tiktok', 'youtube', 'pinterest', 'bluesky', 'mastodon', 'gbp', 'whatsapp'] as const;

export class CommentListQueryDto {
  @ApiPropertyOptional({ enum: COMMENT_KINDS })
  @IsOptional()
  @IsIn(COMMENT_KINDS)
  kind?: (typeof COMMENT_KINDS)[number];

  @ApiPropertyOptional({ enum: COMMENT_STATUS_FILTER })
  @IsOptional()
  @IsIn(COMMENT_STATUS_FILTER)
  status?: (typeof COMMENT_STATUS_FILTER)[number];

  /** CSV of account ids. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accountIds?: string;

  @ApiPropertyOptional({ enum: SOCIAL_PLATFORMS })
  @IsOptional()
  @IsIn(SOCIAL_PLATFORMS)
  platform?: (typeof SOCIAL_PLATFORMS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  postTargetId?: string;

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

export class CommentReplyDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  text!: string;
}

export class PatchCommentStatusDto {
  @ApiProperty({ enum: COMMENT_STATUS })
  @IsIn(COMMENT_STATUS)
  status!: (typeof COMMENT_STATUS)[number];
}

export class MarkDoneDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  ids!: string[];
}
