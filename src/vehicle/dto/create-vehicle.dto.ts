import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsUUID,
  IsOptional,
  IsInt,
  Min,
  MaxLength,
  Matches,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

/**
 * DTO for meta data to be created with vehicle
 */
export class VehicleMetaDto {
  @ApiProperty({ description: 'Meta key', example: 'custom_field_1' })
  @IsString()
  key: string;

  @ApiProperty({ description: 'Meta value', example: 'Some value' })
  @IsString()
  value: string;

  @ApiPropertyOptional({ description: 'Value type', example: 'string', default: 'string' })
  @IsOptional()
  @IsString()
  valueType?: string;

  @ApiPropertyOptional({ description: 'Description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Is public', default: false })
  @IsOptional()
  isPublic?: boolean;
}

/**
 * DTO for creating a new vehicle
 * RouteOne/DealerTrack compliant - requires VIN and basic vehicle info
 */
export class CreateVehicleDto {
  @ApiProperty({
    description: 'Vehicle Identification Number (VIN) - must be unique',
    example: '1HGBH41JXMN109186',
    minLength: 17,
    maxLength: 17,
  })
  @IsString()
  @MaxLength(17)
  @Matches(/^[A-HJ-NPR-Z0-9]{17}$/, {
    message: 'VIN must be 17 characters and contain only valid VIN characters',
  })
  vin: string;

  @ApiPropertyOptional({
    description: 'Internal stock number - must be unique if provided',
    example: 'STK-2024-001',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  stockNumber?: string;

  @ApiProperty({
    description: 'Vehicle year ID (foreign key)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  yearId: string;

  @ApiProperty({
    description: 'Vehicle make ID (foreign key)',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  @IsUUID()
  makeId: string;

  @ApiProperty({
    description: 'Vehicle model ID (foreign key)',
    example: '123e4567-e89b-12d3-a456-426614174002',
  })
  @IsUUID()
  modelId: string;

  @ApiPropertyOptional({
    description: 'Vehicle trim ID (foreign key)',
    example: '123e4567-e89b-12d3-a456-426614174003',
  })
  @IsOptional()
  @IsUUID()
  @Transform(({ value }) => value === '' || value === null ? undefined : value)
  trimId?: string;

  @ApiPropertyOptional({
    description: 'Vehicle mileage in miles',
    example: 50000,
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  mileage?: number;

  @ApiPropertyOptional({
    description: 'Exterior color',
    example: 'Black',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  exteriorColor?: string;

  @ApiPropertyOptional({
    description: 'Interior color',
    example: 'Beige',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  interiorColor?: string;

  @ApiPropertyOptional({
    description: 'Vehicle type ID (nomenclator)',
  })
  @IsOptional()
  @IsUUID('4', { message: 'vehicleTypeId must be a valid UUID' })
  @Transform(({ value }) => value === '' || value === null ? undefined : value)
  vehicleTypeId?: string;

  @ApiPropertyOptional({
    description: 'Body type ID (nomenclator)',
  })
  @IsOptional()
  @IsUUID('4', { message: 'bodyTypeId must be a valid UUID' })
  @Transform(({ value }) => value === '' || value === null ? undefined : value)
  bodyTypeId?: string;

  @ApiPropertyOptional({
    description: 'Fuel type ID (nomenclator)',
  })
  @IsOptional()
  @IsUUID('4', { message: 'fuelTypeId must be a valid UUID' })
  @Transform(({ value }) => value === '' || value === null ? undefined : value)
  fuelTypeId?: string;

  @ApiPropertyOptional({
    description: 'Drive type ID (nomenclator)',
  })
  @IsOptional()
  @IsUUID('4', { message: 'driveTypeId must be a valid UUID' })
  @Transform(({ value }) => value === '' || value === null ? undefined : value)
  driveTypeId?: string;

  @ApiPropertyOptional({
    description: 'Transmission type ID (nomenclator)',
  })
  @IsOptional()
  @IsUUID('4', { message: 'transmissionTypeId must be a valid UUID' })
  @Transform(({ value }) => value === '' || value === null ? undefined : value)
  transmissionTypeId?: string;

  @ApiPropertyOptional({
    description: 'Vehicle condition ID (nomenclator)',
  })
  @IsOptional()
  @IsUUID('4', { message: 'vehicleConditionId must be a valid UUID' })
  @Transform(({ value }) => value === '' || value === null ? undefined : value)
  vehicleConditionId?: string;

  @ApiPropertyOptional({
    description: 'Vehicle status ID (nomenclator)',
  })
  @IsOptional()
  @IsUUID('4', { message: 'vehicleStatusId must be a valid UUID' })
  @Transform(({ value }) => value === '' || value === null ? undefined : value)
  vehicleStatusId?: string;

  @ApiPropertyOptional({
    description: 'Vehicle source ID (nomenclator)',
  })
  @IsOptional()
  @IsUUID('4', { message: 'sourceId must be a valid UUID' })
  @Transform(({ value }) => value === '' || value === null ? undefined : value)
  sourceId?: string;

  @ApiPropertyOptional({
    description: 'Cost price (what we paid for it)',
    example: 15000.5,
  })
  @IsOptional()
  @Type(() => Number)
  costPrice?: number;

  @ApiPropertyOptional({
    description: 'List price (MSRP)',
    example: 22000.0,
  })
  @IsOptional()
  @Type(() => Number)
  listPrice?: number;

  @ApiPropertyOptional({
    description: 'Sale price (current selling price)',
    example: 19500.0,
  })
  @IsOptional()
  @Type(() => Number)
  salePrice?: number;

  @ApiPropertyOptional({
    description: 'Engine description',
    example: '2.5L 4-Cylinder',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  engine?: string;

  @ApiPropertyOptional({
    description: 'Number of cylinders',
    example: 4,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  cylinders?: number;

  @ApiPropertyOptional({
    description: 'Number of doors',
    example: 4,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  doors?: number;

  @ApiPropertyOptional({
    description: 'Passenger capacity',
    example: 5,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  passengers?: number;

  @ApiPropertyOptional({
    description: 'Vehicle description',
    example: 'Excellent condition, fully loaded with premium features',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({
    description: 'Vehicle features (JSON string or text)',
    example: 'Navigation, Leather Seats, Sunroof, Backup Camera',
  })
  @IsOptional()
  @IsString()
  features?: string;

  @ApiPropertyOptional({
    description: 'Main image ID',
  })
  @IsOptional()
  @IsUUID('4', { message: 'mainImageId must be a valid UUID' })
  @Transform(({ value }) => value === '' || value === null ? undefined : value)
  mainImageId?: string;

  @ApiPropertyOptional({
    description: 'Additional metadata as JSON',
    example: { customField1: 'value1', customField2: 'value2' },
  })
  @IsOptional()
  metaValue?: string;

  @ApiPropertyOptional({
    description: 'Array of metadata entries to create with this vehicle',
    type: [VehicleMetaDto],
    example: [
      { key: 'custom_field_1', value: 'value1', valueType: 'string' },
      { key: 'carfax_report_id', value: '12345', valueType: 'string' },
    ],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VehicleMetaDto)
  metas?: VehicleMetaDto[];
}
