import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsUUID,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsInt,
  Min,
  MaxLength,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePartDto {
  @ApiProperty({
    description: 'Name of the part',
    example: 'Front Bumper Cover',
  })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({
    description: 'OEM or aftermarket part number',
    example: '52119-47904',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  partNumber?: string;

  @ApiPropertyOptional({
    description: 'Internal SKU',
    example: 'SKU-BMP-001',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;

  @ApiPropertyOptional({
    description: 'Detailed description of the part',
    example: 'OEM front bumper cover for Toyota Prius 2016-2019, black unpainted',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Internal notes',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description: 'Category ID',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiProperty({
    description: 'Condition ID (New, Used, Rebuilt, etc.)',
  })
  @IsUUID()
  conditionId: string;

  @ApiProperty({
    description: 'Status ID (In Stock, Sold, Reserved, etc.)',
  })
  @IsUUID()
  statusId: string;

  @ApiPropertyOptional({
    description: 'Acquisition cost',
    example: 150.0,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  cost?: number;

  @ApiProperty({
    description: 'Sale price',
    example: 299.99,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  price: number;

  @ApiPropertyOptional({
    description: 'Quantity in stock',
    default: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  quantity?: number;

  @ApiPropertyOptional({
    description: 'Minimum quantity for alert',
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  minQuantity?: number;

  @ApiPropertyOptional({
    description: 'Warehouse location (shelf, bin, etc.)',
    example: 'A-12-3',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  location?: string;

  @ApiPropertyOptional({
    description: 'Warehouse section',
    example: 'Body Parts',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  warehouseSection?: string;

  // Vehicle compatibility
  @ApiPropertyOptional({
    description: 'Compatible year ID',
  })
  @IsOptional()
  @IsUUID()
  yearId?: string;

  @ApiPropertyOptional({
    description: 'Compatible make ID',
  })
  @IsOptional()
  @IsUUID()
  makeId?: string;

  @ApiPropertyOptional({
    description: 'Compatible model ID',
  })
  @IsOptional()
  @IsUUID()
  modelId?: string;

  @ApiPropertyOptional({
    description: 'Compatible trim ID',
  })
  @IsOptional()
  @IsUUID()
  trimId?: string;

  // Source vehicle info
  @ApiPropertyOptional({
    description: 'VIN of the source vehicle (for used parts)',
    example: '1HGBH41JXMN109186',
  })
  @IsOptional()
  @IsString()
  @MaxLength(17)
  sourceVin?: string;

  @ApiPropertyOptional({
    description: 'Mileage of the source vehicle',
    example: 85000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  sourceMiles?: number;

  @ApiPropertyOptional({
    description: 'Source vehicle ID (if in system)',
  })
  @IsOptional()
  @IsUUID()
  sourceVehicleId?: string;

  @ApiPropertyOptional({
    description: 'Main image ID',
  })
  @IsOptional()
  @IsUUID()
  mainImageId?: string;

  // Dimensions
  @ApiPropertyOptional({
    description: 'Weight in pounds',
    example: 12.5,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  weight?: number;

  @ApiPropertyOptional({
    description: 'Length in inches',
    example: 48.0,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  length?: number;

  @ApiPropertyOptional({
    description: 'Width in inches',
    example: 24.0,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  width?: number;

  @ApiPropertyOptional({
    description: 'Height in inches',
    example: 12.0,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  height?: number;

  // Warranty
  @ApiPropertyOptional({
    description: 'Warranty days',
    example: 90,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  warrantyDays?: number;

  @ApiPropertyOptional({
    description: 'Warranty notes',
  })
  @IsOptional()
  @IsString()
  warrantyNotes?: string;

  // Supplier info
  @ApiPropertyOptional({
    description: 'Supplier name',
    example: 'LKQ Corporation',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  supplier?: string;

  @ApiPropertyOptional({
    description: 'Supplier part number',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  supplierPartNumber?: string;

  @ApiPropertyOptional({
    description: 'Purchase date',
  })
  @IsOptional()
  @IsDateString()
  purchaseDate?: string;

  @ApiPropertyOptional({
    description: 'Purchase order number',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  purchaseOrderNumber?: string;

  // Additional info
  @ApiPropertyOptional({
    description: 'Part brand',
    example: 'Toyota',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string;

  @ApiPropertyOptional({
    description: 'Manufacturer',
    example: 'Toyota Motor Corporation',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  manufacturer?: string;

  @ApiPropertyOptional({
    description: 'Country of origin',
    example: 'Japan',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  countryOfOrigin?: string;

  @ApiPropertyOptional({
    description: 'Is OEM original part',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isOem?: boolean;

  @ApiPropertyOptional({
    description: 'Is aftermarket part',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isAftermarket?: boolean;

  @ApiPropertyOptional({
    description: 'Additional metadata',
  })
  @IsOptional()
  metaValue?: Record<string, any>;
}
