import { IsOptional, IsString, IsInt, IsBoolean, IsArray, Min, Max } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SearchAuctionsDto {
  // === PAGINATION ===

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 25, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;

  // === SORTING ===

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: ['year', 'make', 'odometer', 'saleDate', 'highBid', 'estRetailValue', 'createdAt', 'dom', 'locationState', 'saleTitleType'],
    default: 'createdAt'
  })
  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({ description: 'Sort order', enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';

  // === COMMON FILTERS ===

  @ApiPropertyOptional({ description: 'Full text search (VIN, make, model, lot number)' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by source', enum: ['copart', 'marketcheck'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') return value.split(',');
    return value;
  })
  source?: string[];

  @ApiPropertyOptional({ description: 'Filter by source IDs (comma-separated lotNumbers or externalIds)' })
  @IsOptional()
  @IsString()
  sourceIds?: string;

  @ApiPropertyOptional({ description: 'Filter by listing IDs (comma-separated UUIDs)' })
  @IsOptional()
  @IsString()
  ids?: string;

  @ApiPropertyOptional({ description: 'Filter by VIN' })
  @IsOptional()
  @IsString()
  vin?: string;

  @ApiPropertyOptional({ description: 'Filter by year' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  year?: number;

  @ApiPropertyOptional({ description: 'Minimum year' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  yearMin?: number;

  @ApiPropertyOptional({ description: 'Maximum year' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  yearMax?: number;

  @ApiPropertyOptional({ description: 'Filter by make (comma-separated for multiple)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') return value.split(',');
    return value;
  })
  make?: string[];

  @ApiPropertyOptional({ description: 'Filter by model (comma-separated for multiple)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') return value.split(',');
    return value;
  })
  model?: string[];

  @ApiPropertyOptional({ description: 'Filter by body type (comma-separated for multiple)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') return value.split(',');
    return value;
  })
  bodyType?: string[];

  @ApiPropertyOptional({ description: 'Filter by trim (comma-separated for multiple)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') return value.split(',');
    return value;
  })
  trim?: string[];

  @ApiPropertyOptional({ description: 'Filter by yard name (comma-separated for multiple)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') return value.split(',');
    return value;
  })
  yardName?: string[];

  @ApiPropertyOptional({ description: 'Filter by seller name (comma-separated for multiple)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') return value.split(',');
    return value;
  })
  sellerName?: string[];

  @ApiPropertyOptional({ description: 'Exclude listings without a seller name' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  excludeUnknownSellers?: boolean;

  @ApiPropertyOptional({ description: 'Filter by transmission' })
  @IsOptional()
  @IsString()
  transmission?: string;

  @ApiPropertyOptional({ description: 'Filter by fuel type' })
  @IsOptional()
  @IsString()
  fuelType?: string;

  @ApiPropertyOptional({ description: 'Filter by drivetrain (comma-separated for multiple)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') return value.split(',');
    return value;
  })
  drivetrain?: string[];

  @ApiPropertyOptional({ description: 'Filter by exterior color (comma-separated for multiple)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') return value.split(',');
    return value;
  })
  color?: string[];

  @ApiPropertyOptional({ description: 'Filter by cylinder count (comma-separated for multiple)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') return value.split(',');
    return value;
  })
  cylinders?: string[];

  @ApiPropertyOptional({ description: 'Filter by Source / seller category (Insurance, Rental, Repo, Other)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') return value.split(',');
    return value;
  })
  sellerCategory?: string[];

  @ApiPropertyOptional({ description: 'Minimum engine size in litres' })
  @IsOptional()
  @Type(() => Number)
  engineSizeMin?: number;

  @ApiPropertyOptional({ description: 'Maximum engine size in litres' })
  @IsOptional()
  @Type(() => Number)
  engineSizeMax?: number;

  @ApiPropertyOptional({ description: 'Center ZIP code for radius search' })
  @IsOptional()
  @IsString()
  zip?: string;

  @ApiPropertyOptional({ description: 'Radius in miles around the ZIP code' })
  @IsOptional()
  @Type(() => Number)
  radiusMiles?: number;

  @ApiPropertyOptional({ description: 'Filter by location state (comma-separated for multiple)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') return value.split(',');
    return value;
  })
  locationState?: string[];

  @ApiPropertyOptional({ description: 'Minimum odometer' })
  @IsOptional()
  @Type(() => Number)
  odometerMin?: number;

  @ApiPropertyOptional({ description: 'Maximum odometer' })
  @IsOptional()
  @Type(() => Number)
  odometerMax?: number;

  @ApiPropertyOptional({ description: 'Filter by odometer brand (A=Actual, E=Exempt, N=Not Actual)' })
  @IsOptional()
  @IsString()
  odometerBrand?: string;

  // === COPART SPECIFIC FILTERS ===

  @ApiPropertyOptional({ description: 'Filter by damage description (comma-separated)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') return value.split(',');
    return value;
  })
  damageDescription?: string[];

  @ApiPropertyOptional({ description: 'Filter by sale status' })
  @IsOptional()
  @IsString()
  saleStatus?: string;

  @ApiPropertyOptional({ description: 'Filter by sale title type (comma-separated raw codes)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') return value.split(',');
    return value;
  })
  saleTitleType?: string[];

  @ApiPropertyOptional({ description: 'Filter by primary title category (comma-separated: clean, nonrepairable, salvage)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') return value.split(',');
    return value;
  })
  titleCategory?: string[];

  @ApiPropertyOptional({ description: 'Filter by has keys (Yes/No)' })
  @IsOptional()
  @IsString()
  hasKeys?: string;

  @ApiPropertyOptional({ description: 'Filter by runs/drives' })
  @IsOptional()
  @IsString()
  runsDrives?: string;

  @ApiPropertyOptional({ description: 'Filter by lot condition code' })
  @IsOptional()
  @IsString()
  lotCondCode?: string;

  @ApiPropertyOptional({ description: 'Filter by wholesale (Y/N)' })
  @IsOptional()
  @IsString()
  wholesale?: string;

  @ApiPropertyOptional({ description: 'Filter by sale light (comma-separated: GREEN LIGHT, YELLOW LIGHT, RED LIGHT)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') return value.split(',');
    return value;
  })
  saleLight?: string[];

  @ApiPropertyOptional({ description: 'Minimum estimated retail value' })
  @IsOptional()
  @Type(() => Number)
  priceMin?: number;

  @ApiPropertyOptional({ description: 'Maximum estimated retail value' })
  @IsOptional()
  @Type(() => Number)
  priceMax?: number;

  @ApiPropertyOptional({ description: 'Sale date from (YYYYMMDD)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  saleDateFrom?: number;

  @ApiPropertyOptional({ description: 'Sale date to (YYYYMMDD)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  saleDateTo?: number;

  // === MARKETCHECK SPECIFIC FILTERS ===

  @ApiPropertyOptional({ description: 'Filter by Carfax clean title' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  carfaxCleanTitle?: boolean;

  @ApiPropertyOptional({ description: 'Filter by Carfax 1 owner' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  carfax1Owner?: boolean;

  @ApiPropertyOptional({ description: 'Maximum days on market' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  domMax?: number;

  @ApiPropertyOptional({ description: 'Filter listings that have a Carfax PDF report uploaded' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  hasCarfaxReport?: boolean;

  @ApiPropertyOptional({ description: 'Filter listings that have a Buy-It-Now price (> 0)' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  hasBuyItNow?: boolean;

  @ApiPropertyOptional({ description: 'When true, show only lots marked as discarded. When omitted, show all lots.' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  discarded?: boolean;

  @ApiPropertyOptional({
    description:
      'Solo lotes que el modelo puede tasar ya: sus fotos estan convertidas y ' +
      'con la misma agrupacion que usa el modelo servido',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  readyForPricing?: boolean;


  @ApiPropertyOptional({ description: 'When true, restrict results to lots located in yards that have physicalInspectionAvailable=true' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  inspectableOnly?: boolean;

  // === AGGREGATIONS ===

  @ApiPropertyOptional({ description: 'Include aggregations in response', default: false })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeAggregations?: boolean = false;
}
