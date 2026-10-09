import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** CSV ("a,b") o array → string[]. */
const csv = () =>
  Transform(({ value }) =>
    value === undefined || value === null || value === ''
      ? undefined
      : Array.isArray(value)
        ? value
        : String(value).split(',').map((v) => v.trim()).filter(Boolean),
  );

/**
 * Filtros de las graficas: el mismo vocabulario que `/auction-sale-results`
 * (QueryStatsDto), recortado a lo que tiene sentido agregar.
 */
export class AnalyticsQueryDto {
  @ApiPropertyOptional({ description: 'copart (default), iaai or copart,iaai' })
  @IsOptional() @csv() @IsArray() @IsIn(['copart', 'iaai'], { each: true })
  source?: ('copart' | 'iaai')[];

  @ApiPropertyOptional() @IsOptional() @csv() @IsArray() @IsString({ each: true })
  make?: string[];
  @ApiPropertyOptional() @IsOptional() @csv() @IsArray() @IsString({ each: true })
  model?: string[];
  @ApiPropertyOptional() @IsOptional() @csv() @IsArray() @IsString({ each: true })
  locationState?: string[];
  @ApiPropertyOptional() @IsOptional() @csv() @IsArray() @IsString({ each: true })
  damageDescription?: string[];
  @ApiPropertyOptional() @IsOptional() @csv() @IsArray() @IsString({ each: true })
  sellerCategory?: string[];
  @ApiPropertyOptional({ description: 'clean, salvage, nonrepairable, unknown' })
  @IsOptional() @csv() @IsArray() @IsString({ each: true })
  titleCategory?: string[];

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt()
  yearMin?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt()
  yearMax?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number)
  odometerMin?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number)
  odometerMax?: number;
  @ApiPropertyOptional({ description: 'YYYYMMDD' }) @IsOptional() @Type(() => Number) @IsInt()
  saleDateFrom?: number;
  @ApiPropertyOptional({ description: 'YYYYMMDD' }) @IsOptional() @Type(() => Number) @IsInt()
  saleDateTo?: number;

  @ApiPropertyOptional({ enum: ['day', 'week', 'month'], description: 'trend: bucket size (auto if omitted)' })
  @IsOptional() @IsIn(['day', 'week', 'month'])
  interval?: 'day' | 'week' | 'month';

  @ApiPropertyOptional({ description: 'distribution: number of bins (5-60)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(60)
  bins?: number;

  @ApiPropertyOptional({ description: 'kpis: period length in days (7-365)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(7) @Max(365)
  days?: number;

  @ApiPropertyOptional({ description: 'damage: max groups returned (3-20, default 10)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(3) @Max(20)
  limit?: number;

  @ApiPropertyOptional({ description: 'odometer: bucket size' })
  @IsOptional() @Type(() => Number) @IsIn([10000, 25000, 50000])
  step?: number;

  @ApiPropertyOptional({ description: 'compare: 2-4 "make:model" entries, comma-separated' })
  @IsOptional() @csv() @IsArray() @ArrayMaxSize(20) @IsString({ each: true })
  vehicles?: string[];
}
