import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsBoolean,
  IsOptional,
  IsUUID,
  IsEnum,
  MaxLength,
} from 'class-validator';

/**
 * Valid entity types for Meta
 */
export enum MetaEntityType {
  USER = 'user',
  VEHICLE = 'vehicle',
  BUYER = 'buyer',
  DEAL = 'deal',
  TITLE = 'title',
  MEDIA = 'media',
  VEHICLE_YEAR = 'vehicleYear',
  VEHICLE_MAKE = 'vehicleMake',
  VEHICLE_MODEL = 'vehicleModel',
  VEHICLE_TRIM = 'vehicleTrim',
  EXTRA_EXPENSE = 'extraExpense',
}

/**
 * Valid value types for Meta
 */
export enum MetaValueType {
  STRING = 'string',
  NUMBER = 'number',
  BOOLEAN = 'boolean',
  JSON = 'json',
  DATE = 'date',
}

/**
 * DTO for creating a new meta entry
 */
export class CreateMetaDto {
  @ApiProperty({
    description: 'Type of entity this meta belongs to',
    enum: MetaEntityType,
    example: MetaEntityType.VEHICLE,
  })
  @IsEnum(MetaEntityType)
  entityType: MetaEntityType;

  @ApiProperty({
    description: 'ID of the entity',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  entityId: string;

  @ApiPropertyOptional({
    description: 'User ID who created this meta',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiProperty({
    description: 'Meta key/name',
    example: 'custom_field_1',
    maxLength: 255,
  })
  @IsString()
  @MaxLength(255)
  key: string;

  @ApiProperty({
    description: 'Meta value as string',
    example: 'Some custom value',
  })
  @IsString()
  value: string;

  @ApiPropertyOptional({
    description: 'Type of value stored',
    enum: MetaValueType,
    default: MetaValueType.STRING,
  })
  @IsOptional()
  @IsEnum(MetaValueType)
  valueType?: MetaValueType;

  @ApiPropertyOptional({
    description: 'Description of this meta field',
    example: 'Custom field for tracking special requirements',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    description: 'Is this meta publicly visible',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional({
    description: 'Is this a system meta (not user-editable)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isSystem?: boolean;

  @ApiPropertyOptional({
    description: 'Is this meta active',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
