import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, IsInt, IsString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO for querying vehicles with filters and pagination
 */
export class QueryVehicleDto {
  @ApiPropertyOptional({
    description: 'Page number',
    example: 1,
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Items per page',
    example: 10,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 10;

  @ApiPropertyOptional({
    description: 'Filter by VIN (partial match)',
    example: '1HGBH41',
  })
  @IsOptional()
  @IsString()
  vin?: string;

  @ApiPropertyOptional({
    description: 'Filter by stock number (partial match)',
    example: 'STK-2024',
  })
  @IsOptional()
  @IsString()
  stockNumber?: string;

  @ApiPropertyOptional({
    description: 'Filter by year ID',
  })
  @IsOptional()
  @IsUUID()
  yearId?: string;

  @ApiPropertyOptional({
    description: 'Filter by make ID',
  })
  @IsOptional()
  @IsUUID()
  makeId?: string;

  @ApiPropertyOptional({
    description: 'Filter by model ID',
  })
  @IsOptional()
  @IsUUID()
  modelId?: string;

  @ApiPropertyOptional({
    description: 'Filter by trim ID',
  })
  @IsOptional()
  @IsUUID()
  trimId?: string;

  @ApiPropertyOptional({
    description: 'Filter by vehicle type ID',
  })
  @IsOptional()
  @IsUUID()
  vehicleTypeId?: string;

  @ApiPropertyOptional({
    description: 'Filter by body type ID',
  })
  @IsOptional()
  @IsUUID()
  bodyTypeId?: string;

  @ApiPropertyOptional({
    description: 'Filter by fuel type ID',
  })
  @IsOptional()
  @IsUUID()
  fuelTypeId?: string;

  @ApiPropertyOptional({
    description: 'Filter by drive type ID',
  })
  @IsOptional()
  @IsUUID()
  driveTypeId?: string;

  @ApiPropertyOptional({
    description: 'Filter by transmission type ID',
  })
  @IsOptional()
  @IsUUID()
  transmissionTypeId?: string;

  @ApiPropertyOptional({
    description: 'Filter by vehicle condition ID',
  })
  @IsOptional()
  @IsUUID()
  vehicleConditionId?: string;

  @ApiPropertyOptional({
    description: 'Filter by vehicle status ID',
  })
  @IsOptional()
  @IsUUID()
  vehicleStatusId?: string;

  @ApiPropertyOptional({
    description: 'Filter by source ID',
  })
  @IsOptional()
  @IsUUID()
  sourceId?: string;

  @ApiPropertyOptional({
    description: 'Minimum mileage',
    example: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  minMileage?: number;

  @ApiPropertyOptional({
    description: 'Maximum mileage',
    example: 100000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  maxMileage?: number;

  @ApiPropertyOptional({
    description: 'Minimum price',
    example: 10000,
  })
  @IsOptional()
  @Type(() => Number)
  minPrice?: number;

  @ApiPropertyOptional({
    description: 'Maximum price',
    example: 50000,
  })
  @IsOptional()
  @Type(() => Number)
  maxPrice?: number;

  @ApiPropertyOptional({
    description: 'Search term (searches across VIN, stock number, description)',
    example: 'Honda Accord',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
