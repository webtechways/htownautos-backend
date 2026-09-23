import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const SCHEDULE_MODES = ['draft', 'queue', 'next', 'now', 'custom'] as const;
const PUBLISH_TABS = ['queue', 'drafts', 'approvals', 'sent'] as const;

export class ThreadItemDto {
  @ApiProperty()
  @IsString()
  content!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID(undefined, { each: true })
  mediaIds!: string[];
}

export class TargetInputDto {
  @ApiProperty()
  @IsUUID()
  accountId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  content?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  mediaIds?: string[] | null;

  /** Per-platform options bag (contract.ts `PlatformOptions`) — validated by business rules, not per-key here. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [ThreadItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ThreadItemDto)
  thread?: ThreadItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  firstComment?: string | null;
}

export class CreatePostDto {
  @ApiProperty()
  @IsString()
  content!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  mediaIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  tagIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ideaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  aiGenerated?: boolean;

  @ApiProperty({ enum: SCHEDULE_MODES })
  @IsIn(SCHEDULE_MODES)
  mode!: (typeof SCHEDULE_MODES)[number];

  /** Required when mode = custom. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @ApiProperty({ type: [TargetInputDto] })
  @IsArray()
  @ArrayUnique((t: TargetInputDto) => t.accountId)
  @ValidateNested({ each: true })
  @Type(() => TargetInputDto)
  targets!: TargetInputDto[];
}

export class UpdatePostDto extends PartialType(CreatePostDto) {}

export class PostListQueryDto {
  @ApiPropertyOptional({ enum: PUBLISH_TABS })
  @IsOptional()
  @IsIn(PUBLISH_TABS)
  tab?: (typeof PUBLISH_TABS)[number];

  /** CSV of account ids. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accountIds?: string;

  /** CSV of tag ids. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tagIds?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;

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

  /** Up to 500 when `from`/`to` (calendar) are set — enforced in the service, not here. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class QueueSlotsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accountIds?: string;

  @ApiProperty()
  @IsDateString()
  from!: string;

  @ApiProperty()
  @IsDateString()
  to!: string;
}

export class RescheduleDto {
  @ApiProperty()
  @IsDateString()
  scheduledAt!: string;

  /** Only this channel; omitted = every not-yet-published target of the post. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  targetId?: string;
}

export class RejectDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  note!: string;
}

export class MarkPublishedDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  externalUrl?: string;
}

export class ScheduleSlotDto {
  @ApiProperty({ minimum: 0, maximum: 6 })
  @IsInt()
  @Min(0)
  @Max(6)
  day!: 0 | 1 | 2 | 3 | 4 | 5 | 6;

  /** "HH:mm", 24h. */
  @ApiProperty()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  time!: string;
}

export class UpdatePostingScheduleDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  timezone!: string;

  @ApiProperty()
  @IsBoolean()
  paused!: boolean;

  @ApiProperty({ type: [ScheduleSlotDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScheduleSlotDto)
  slots!: ScheduleSlotDto[];
}

/** Element of `PUT /social/goals`'s raw array body (contract.ts `SocialGoal`). */
export class SocialGoalInputDto {
  @ApiProperty()
  @IsUUID()
  accountId!: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(100)
  postsPerWeek!: number;
}
