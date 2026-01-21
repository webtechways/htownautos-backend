import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Vehicle Entity
 * Represents a vehicle in the inventory
 */
export class Vehicle {
  @ApiProperty({
    description: 'Unique identifier',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'Vehicle Identification Number (VIN)',
    example: '1HGBH41JXMN109186',
  })
  vin: string;

  @ApiPropertyOptional({
    description: 'Stock number',
    example: 'STK-2024-001',
  })
  stockNumber?: string;

  @ApiProperty({ description: 'Vehicle year ID' })
  yearId: string;

  @ApiProperty({ description: 'Vehicle make ID' })
  makeId: string;

  @ApiProperty({ description: 'Vehicle model ID' })
  modelId: string;

  @ApiPropertyOptional({ description: 'Vehicle trim ID' })
  trimId?: string;

  @ApiPropertyOptional({ description: 'Mileage in miles' })
  mileage?: number;

  @ApiPropertyOptional({ description: 'Exterior color' })
  exteriorColor?: string;

  @ApiPropertyOptional({ description: 'Interior color' })
  interiorColor?: string;

  @ApiPropertyOptional({ description: 'Vehicle type ID' })
  vehicleTypeId?: string;

  @ApiPropertyOptional({ description: 'Body type ID' })
  bodyTypeId?: string;

  @ApiPropertyOptional({ description: 'Fuel type ID' })
  fuelTypeId?: string;

  @ApiPropertyOptional({ description: 'Drive type ID' })
  driveTypeId?: string;

  @ApiPropertyOptional({ description: 'Transmission type ID' })
  transmissionTypeId?: string;

  @ApiPropertyOptional({ description: 'Vehicle condition ID' })
  vehicleConditionId?: string;

  @ApiPropertyOptional({ description: 'Vehicle status ID' })
  vehicleStatusId?: string;

  @ApiPropertyOptional({ description: 'Source ID' })
  sourceId?: string;

  @ApiPropertyOptional({ description: 'Cost price' })
  costPrice?: number;

  @ApiPropertyOptional({ description: 'List price' })
  listPrice?: number;

  @ApiPropertyOptional({ description: 'Sale price' })
  salePrice?: number;

  @ApiPropertyOptional({ description: 'Engine description' })
  engine?: string;

  @ApiPropertyOptional({ description: 'Number of cylinders' })
  cylinders?: number;

  @ApiPropertyOptional({ description: 'Number of doors' })
  doors?: number;

  @ApiPropertyOptional({ description: 'Passenger capacity' })
  passengers?: number;

  @ApiPropertyOptional({ description: 'Vehicle description' })
  description?: string;

  @ApiPropertyOptional({ description: 'Features' })
  features?: string;

  @ApiPropertyOptional({ description: 'Main image ID' })
  mainImageId?: string;

  @ApiPropertyOptional({ description: 'Metadata' })
  metaValue?: any;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: Date;
}
