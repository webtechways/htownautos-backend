import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsUUID,
  IsOptional,
  IsBoolean,
  MaxLength,
} from 'class-validator';

// ========================================
// Part Condition DTOs
// ========================================

export class CreatePartConditionDto {
  @ApiProperty({
    description: 'URL-friendly slug',
    example: 'used',
  })
  @IsString()
  @MaxLength(100)
  slug: string;

  @ApiProperty({
    description: 'Display title',
    example: 'Used',
  })
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional({
    description: 'Is active',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePartConditionDto extends PartialType(CreatePartConditionDto) {}

// ========================================
// Part Status DTOs
// ========================================

export class CreatePartStatusDto {
  @ApiProperty({
    description: 'URL-friendly slug',
    example: 'in-stock',
  })
  @IsString()
  @MaxLength(100)
  slug: string;

  @ApiProperty({
    description: 'Display title',
    example: 'In Stock',
  })
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional({
    description: 'Is active',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePartStatusDto extends PartialType(CreatePartStatusDto) {}

// ========================================
// Part Category DTOs
// ========================================

export class CreatePartCategoryDto {
  @ApiProperty({
    description: 'URL-friendly slug',
    example: 'engine-parts',
  })
  @IsString()
  @MaxLength(100)
  slug: string;

  @ApiProperty({
    description: 'Display title',
    example: 'Engine Parts',
  })
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional({
    description: 'Category description',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Parent category ID (for subcategories)',
  })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({
    description: 'Is active',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePartCategoryDto extends PartialType(CreatePartCategoryDto) {}
