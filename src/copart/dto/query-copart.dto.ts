import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryCopartDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  make?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  year?: number;

  @IsOptional()
  @IsString()
  damageDescription?: string;

  @IsOptional()
  @IsString()
  saleStatus?: string;

  @IsOptional()
  @IsString()
  locationState?: string;

  @IsOptional()
  @Type(() => Number)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  maxPrice?: number;

  @IsOptional()
  @Type(() => Number)
  minOdometer?: number;

  @IsOptional()
  @Type(() => Number)
  maxOdometer?: number;

  @IsOptional()
  @IsString()
  hasKeys?: string;

  @IsOptional()
  @IsString()
  runsDrives?: string;

  @IsOptional()
  @IsString()
  saleTitleType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  saleDateFrom?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  saleDateTo?: number;

  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
