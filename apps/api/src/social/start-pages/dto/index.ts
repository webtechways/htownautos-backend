import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsBoolean, IsDateString, IsIn, IsOptional, IsString, IsUUID, MinLength, ValidateNested } from 'class-validator';

const START_BLOCK_TYPES = ['link', 'header', 'text', 'image', 'social', 'video', 'divider'] as const;
const BUTTON_STYLES = ['filled', 'outline', 'soft'] as const;
const FONTS = ['system', 'serif', 'mono', 'rounded'] as const;
const AVATAR_SHAPES = ['circle', 'square'] as const;
const SOCIAL_PLATFORMS = ['facebook', 'instagram', 'threads', 'x', 'linkedin', 'tiktok', 'youtube', 'pinterest', 'bluesky', 'mastodon', 'gbp', 'whatsapp'] as const;

export class StartBlockDto {
  @ApiPropertyOptional()
  @IsString()
  @MinLength(1)
  id!: string;

  @ApiPropertyOptional({ enum: START_BLOCK_TYPES })
  @IsIn(START_BLOCK_TYPES)
  type!: (typeof START_BLOCK_TYPES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  text?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  mediaId?: string;

  @ApiPropertyOptional({ enum: SOCIAL_PLATFORMS })
  @IsOptional()
  @IsIn(SOCIAL_PLATFORMS)
  platform?: (typeof SOCIAL_PLATFORMS)[number];

  @ApiPropertyOptional()
  @IsBoolean()
  enabled!: boolean;
}

export class StartThemeDto {
  @ApiPropertyOptional()
  @IsString()
  background!: string;

  @ApiPropertyOptional()
  @IsString()
  textColor!: string;

  @ApiPropertyOptional()
  @IsString()
  buttonColor!: string;

  @ApiPropertyOptional()
  @IsString()
  buttonTextColor!: string;

  @ApiPropertyOptional({ enum: BUTTON_STYLES })
  @IsIn(BUTTON_STYLES)
  buttonStyle!: (typeof BUTTON_STYLES)[number];

  @ApiPropertyOptional({ enum: FONTS })
  @IsIn(FONTS)
  font!: (typeof FONTS)[number];

  @ApiPropertyOptional({ enum: AVATAR_SHAPES })
  @IsIn(AVATAR_SHAPES)
  avatarShape!: (typeof AVATAR_SHAPES)[number];
}

/** Verbatim shape of contract.ts `StartPageInput` — every field optional, PATCH-style. */
export class StartPageInputDto {
  @ApiPropertyOptional({ description: 'lowercase a-z 0-9 and "-", 3..40, globally unique' })
  @IsOptional()
  @IsString()
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  avatarMediaId?: string;

  @ApiPropertyOptional({ type: StartThemeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => StartThemeDto)
  theme?: StartThemeDto;

  @ApiPropertyOptional({ type: [StartBlockDto] })
  @IsOptional()
  @IsArray()
  @ArrayUnique((b: StartBlockDto) => b.id)
  @ValidateNested({ each: true })
  @Type(() => StartBlockDto)
  blocks?: StartBlockDto[];
}

export class StartPageStatsQueryDto {
  @ApiPropertyOptional({ example: '2026-08-01', description: 'YYYY-MM-DD, defaults to 30 days ago' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-31', description: 'YYYY-MM-DD, defaults to today' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
