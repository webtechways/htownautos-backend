import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

/** Settings → IAAI Scraper. Every field optional: the UI saves what it changed. */
export class UpdateIaaiScraperConfigDto {
  @IsOptional() @IsBoolean() paused?: boolean;

  @IsOptional() @IsIn(['window', 'interval', 'manual']) scheduleMode?: string;
  @IsOptional() @IsString() @Matches(HHMM) windowStart?: string;
  @IsOptional() @IsString() @Matches(HHMM) windowEnd?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) daysOfWeek?: number[];
  @IsOptional() @IsInt() @Min(0) @Max(168) intervalHours?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10080) maxRunMinutes?: number;

  @IsOptional() @IsInt() @Min(10) @Max(500) pageSize?: number;
  @IsOptional() @IsInt() @Min(0) @Max(120000) pageDelayMinMs?: number;
  @IsOptional() @IsInt() @Min(0) @Max(300000) pageDelayMaxMs?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000) maxPagesPerRun?: number;
  @IsOptional() @IsInt() @Min(5000) @Max(300000) requestTimeoutMs?: number;
  @IsOptional() @IsInt() @Min(1) @Max(10) maxRetries?: number;
  @IsOptional() @IsBoolean() useProxy?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(2160) inactiveAfterHours?: number;

  @IsOptional() @IsBoolean() downloadImages?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(200) imageLotsPerTick?: number;
  @IsOptional() @IsInt() @Min(1) @Max(16) imageConcurrency?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) imageMaxPerLot?: number;
  @IsOptional() @IsInt() @Min(1) @Max(20) imageMaxAttempts?: number;
  @IsOptional() @IsBoolean() imagesOnlyUpcoming?: boolean;
}

export class StartIaaiRunDto {
  /** Stop this pass after N minutes (0/absent = the configured limit). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10080) maxRunMinutes?: number;
}
