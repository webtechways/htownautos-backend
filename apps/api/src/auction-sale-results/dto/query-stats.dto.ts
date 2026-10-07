import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** CSV string ("a,b,c") or array → string[]. */
const csv = () =>
  Transform(({ value }) =>
    value === undefined || value === null
      ? undefined
      : Array.isArray(value)
        ? value
        : String(value)
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean),
  );

/** "true"/"false"/bool → boolean. */
const bool = () =>
  Transform(({ value }) =>
    value === undefined || value === null || value === ''
      ? undefined
      : value === true || value === 'true' || value === '1',
  );

/**
 * Filters for the Stats Listing (auction_sale_results). Mirrors the auction
 * search filters (same promoted vehicle columns) and adds the Final Bid range.
 */
export class QueryStatsDto {
  @ApiPropertyOptional({ enum: ['copart', 'iaai'], default: 'copart', description: 'Which auction: copart → auction_sale_results, iaai → iaai_sale_results' })
  @IsOptional() @IsIn(['copart', 'iaai'])
  source?: 'copart' | 'iaai';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number = 25;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: ['saleDate', 'finalBid', 'askingPrice', 'year', 'make', 'odometer', 'receivedAt', 'createdAt'],
    default: 'saleDate',
  })
  @IsOptional() @IsString()
  sortBy?: string = 'saleDate';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional() @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ description: 'Full-text search (VIN, make, model, lot)' })
  @IsOptional() @IsString()
  search?: string;

  // ── Multi-select facets (map to promoted columns) ──
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) @csv()
  make?: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) @csv()
  model?: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) @csv()
  trim?: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) @csv()
  bodyType?: string[]; // bodyStyle
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) @csv()
  color?: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) @csv()
  cylinders?: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) @csv()
  drivetrain?: string[]; // drive
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) @csv()
  damageDescription?: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) @csv()
  saleTitleType?: string[];
  @ApiPropertyOptional({ description: 'Derived title categories (clean/salvage/nonrepairable/unknown)' })
  @IsOptional() @IsArray() @IsString({ each: true }) @csv()
  titleCategory?: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) @csv()
  locationState?: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) @csv()
  yardName?: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) @csv()
  sellerName?: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) @csv()
  sellerCategory?: string[];

  // ── Single-value facets (match the shared sidebar's QueryAuctionDto) ──
  @ApiPropertyOptional() @IsOptional() @IsString()
  transmission?: string;
  @ApiPropertyOptional() @IsOptional() @IsString()
  fuelType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString()
  runsDrives?: string;
  @ApiPropertyOptional({ description: 'Status ("Sold" / "Not Sold")' })
  @IsOptional() @IsString()
  saleStatus?: string;

  // ── Ranges ──
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt()
  yearMin?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt()
  yearMax?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number)
  odometerMin?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number)
  odometerMax?: number;
  @ApiPropertyOptional({ description: 'Final bid minimum' })
  @IsOptional() @Type(() => Number)
  finalBidMin?: number;
  @ApiPropertyOptional({ description: 'Final bid maximum' })
  @IsOptional() @Type(() => Number)
  finalBidMax?: number;
  @ApiPropertyOptional({ description: 'Sale date from (YYYYMMDD)' })
  @IsOptional() @Type(() => Number) @IsInt()
  saleDateFrom?: number;
  @ApiPropertyOptional({ description: 'Sale date to (YYYYMMDD)' })
  @IsOptional() @Type(() => Number) @IsInt()
  saleDateTo?: number;

  // ── Booleans ──
  @ApiPropertyOptional({ description: 'Only sold (true) / not sold (false)' })
  @IsOptional() @bool() @IsBoolean()
  sold?: boolean;

  @ApiPropertyOptional({ description: 'Include facet aggregations in the response' })
  @IsOptional() @bool() @IsBoolean()
  includeAggregations?: boolean;
}
