import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { REPORT_TYPES } from './types';
import type { ReportType } from './types';

export class OrderReportDto {
  @ApiProperty({ example: '1FMCU9GD6KUA12112' })
  @IsString()
  @Length(17, 25)
  vin!: string;

  @ApiProperty({ enum: REPORT_TYPES })
  @IsIn(REPORT_TYPES)
  type!: ReportType;

  @ApiPropertyOptional({ description: 'Skip the cache and order a new report (paid)' })
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @ApiPropertyOptional({ description: 'API keys only: https URL that gets a signed POST when the order completes or fails (X-VH-Signature: t=<unix>,v1=HMAC-SHA256(sha256hex(apiKey), "<t>.<body>"))' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  callbackUrl?: string;

  @ApiPropertyOptional({ description: 'Seconds to wait for the result before answering "running" (0–50, default 25)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  wait?: number;
}

export class TestProviderDto {
  @ApiProperty({ example: '1FMCU9GD6KUA12112' })
  @IsString()
  @Length(17, 25)
  vin!: string;

  @ApiProperty({ enum: REPORT_TYPES })
  @IsIn(REPORT_TYPES)
  type!: ReportType;
}

export class UpdateProviderDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() carfaxEnabled?: boolean;
  @IsOptional() @IsBoolean() autocheckEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Budget for one report from this provider, in ms (10 s – 15 min)' })
  @IsOptional() @IsInt() @Min(10_000) @Max(900_000)
  timeoutMs?: number;

  @ApiPropertyOptional({ description: "'' resets to the adapter default" })
  @IsOptional() @IsString() @MaxLength(300)
  baseUrl?: string;

  @ApiPropertyOptional({ description: "Write-only. '' removes the key set here (the env var applies again)" })
  @IsOptional() @IsString() @MaxLength(500)
  apiKey?: string;
}

export class ReorderProvidersDto {
  @ApiProperty({ type: [String], description: 'Provider keys, first runs first' })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  keys!: string[];
}

export class UpdateSettingsDto {
  @IsOptional() @IsInt() @Min(0) @Max(365) cacheDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(50) circuitFailureThreshold?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1440) circuitCooldownMinutes?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1440) healthCheckMinutes?: number;
  @IsOptional() @IsInt() @Min(7) @Max(730) logRetentionDays?: number;
}

export class LibraryQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional() @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 25 })
  @IsOptional() @IsInt() @Min(1) @Max(100)
  pageSize?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(25)
  vin?: string;

  @ApiPropertyOptional({ enum: ['carfax', 'autocheck'] })
  @IsOptional() @IsIn(['carfax', 'autocheck'])
  reportType?: 'carfax' | 'autocheck';

  @ApiPropertyOptional({ enum: ['crm', 'api', 'upload'] })
  @IsOptional() @IsIn(['crm', 'api', 'upload'])
  origin?: 'crm' | 'api' | 'upload';

  @ApiPropertyOptional({ enum: ['ok', 'partial', 'unsupported', 'failed', 'none'] })
  @IsOptional() @IsIn(['ok', 'partial', 'unsupported', 'failed', 'none'])
  parseStatus?: 'ok' | 'partial' | 'unsupported' | 'failed' | 'none';

  @ApiPropertyOptional({ description: 'ISO date' })
  @IsOptional() @IsString() @MaxLength(40)
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date' })
  @IsOptional() @IsString() @MaxLength(40)
  to?: string;
}
