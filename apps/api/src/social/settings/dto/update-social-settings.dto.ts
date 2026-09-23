import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Matches contract.ts `SocialSettings['utm']` verbatim. Not itself Partial —
 * when `utm` is sent in a PATCH, the caller sends the whole nested object.
 */
export class UpdateSocialSettingsUtmDto {
  @ApiPropertyOptional()
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  source?: string | null;

  @ApiPropertyOptional()
  @IsString()
  medium!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  campaign?: string | null;
}

/** Body of `PATCH /social/settings`. Matches contract.ts `UpdateSocialSettingsRequest`. */
export class UpdateSocialSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  approvalRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  defaultTimezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  shortenLinks?: boolean;

  @ApiPropertyOptional({ type: UpdateSocialSettingsUtmDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateSocialSettingsUtmDto)
  utm?: UpdateSocialSettingsUtmDto;
}
