import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  Min,
  IsEnum,
  IsUUID,
} from 'class-validator';

export enum MediaType {
  IMAGE = 'image',
  VIDEO = 'video',
  DOCUMENT = 'document',
}

export enum MediaCategory {
  EXTERIOR = 'exterior',
  INTERIOR = 'interior',
  ENGINE = 'engine',
  DOCUMENT = 'document',
  RECEIPT = 'receipt',
  TITLE = 'title',
  OTHER = 'other',
}

export class CreateMediaDto {
  @ApiPropertyOptional({
    description: 'Title of the media',
    example: 'Front view of vehicle',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({
    description: 'Description of the media',
    example: 'Clear front view showing the grille and headlights',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Alt text for images',
    example: '2020 Honda Accord front view',
  })
  @IsOptional()
  @IsString()
  alt?: string;

  @ApiProperty({
    description: 'Media type',
    enum: MediaType,
    example: MediaType.IMAGE,
  })
  @IsEnum(MediaType)
  mediaType: MediaType;

  @ApiPropertyOptional({
    description: 'Media category',
    enum: MediaCategory,
    example: MediaCategory.EXTERIOR,
  })
  @IsOptional()
  @IsEnum(MediaCategory)
  category?: MediaCategory;

  @ApiPropertyOptional({
    description: 'Vehicle UUID to associate with',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @ApiPropertyOptional({
    description: 'Buyer UUID to associate with (PRIVATE - automatically sets isPublic to false)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsUUID()
  buyerId?: string;

  @ApiPropertyOptional({
    description: 'Part UUID to associate with',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsUUID()
  partId?: string;

  @ApiPropertyOptional({
    description: 'Whether the media is public (ignored if buyerId is provided - buyer media is always private)',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
