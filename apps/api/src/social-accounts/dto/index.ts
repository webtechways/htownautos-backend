import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsIn, IsArray, IsUUID, IsBoolean, MinLength } from 'class-validator';
import type { AccountType, SocialPlatform } from '@htownautos/social';

/** Runtime-checkable mirror of `SocialPlatform` (docs/social-suite/contract.ts) — kept as a plain union, like the contract itself, not a TS enum (enum members aren't structurally assignable to the lib's string-union type without a cast). */
export const SOCIAL_PLATFORMS = [
  'facebook',
  'instagram',
  'threads',
  'x',
  'linkedin',
  'tiktok',
  'youtube',
  'pinterest',
  'bluesky',
  'mastodon',
  'gbp',
  'whatsapp',
] as const satisfies readonly SocialPlatform[];

export const ACCOUNT_TYPES = [
  'page',
  'group',
  'business',
  'creator',
  'personal',
  'profile',
  'organization',
  'channel',
  'location',
  'phone_number',
] as const satisfies readonly AccountType[];

export class ConnectSocialAccountDto {
  @ApiProperty()
  @IsString()
  code: string;

  @ApiProperty()
  @IsString()
  state: string;

  @ApiProperty()
  @IsString()
  redirectUri: string;

  @ApiPropertyOptional({ enum: SOCIAL_PLATFORMS, description: 'Accepted but ignored when it disagrees with the verified state.' })
  @IsOptional()
  @IsIn(SOCIAL_PLATFORMS)
  platform?: SocialPlatform;
}

export class ConnectBlueskyDto {
  @ApiProperty()
  @IsString()
  identifier: string;

  @ApiProperty()
  @IsString()
  appPassword: string;
}

export class MastodonStartDto {
  @ApiProperty({ description: 'e.g. "mastodon.social" — no scheme' })
  @IsString()
  instance: string;

  @ApiProperty()
  @IsString()
  redirectUri: string;
}

export class WhatsAppEmbeddedSignupDto {
  @ApiProperty()
  @IsString()
  code: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  wabaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phoneNumberId?: string;
}

export class WhatsAppManualConnectDto {
  @ApiProperty()
  @IsString()
  wabaId: string;

  @ApiProperty()
  @IsString()
  phoneNumberId: string;

  @ApiProperty()
  @IsString()
  accessToken: string;
}

export class ReminderChannelDto {
  @ApiProperty({ enum: SOCIAL_PLATFORMS })
  @IsIn(SOCIAL_PLATFORMS)
  platform: SocialPlatform;

  @ApiProperty({ enum: ACCOUNT_TYPES })
  @IsIn(ACCOUNT_TYPES)
  accountType: AccountType;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  profileUrl?: string;
}

export class UpdateSocialAccountDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  queuePaused?: boolean;
}

export class CreateSocialGroupDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  accountIds?: string[];
}

export class UpdateSocialGroupDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  accountIds?: string[];
}
