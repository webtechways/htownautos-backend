import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsEnum, IsUUID } from 'class-validator';
import { MediaType, MediaCategory } from '../../media/dto/create-media.dto';

export class CreateUploadSessionDto {
  @ApiProperty({
    description: 'Entity type to associate uploads with',
    example: 'vehicle',
  })
  @IsString()
  entityType: string;

  @ApiProperty({
    description: 'Entity ID to associate uploads with',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  entityId: string;

  @ApiPropertyOptional({
    description: 'Media type for uploads',
    enum: MediaType,
    default: MediaType.IMAGE,
  })
  @IsOptional()
  @IsEnum(MediaType)
  mediaType?: string;

  @ApiPropertyOptional({
    description: 'Category for uploads',
    enum: MediaCategory,
  })
  @IsOptional()
  @IsEnum(MediaCategory)
  category?: string;

  @ApiPropertyOptional({
    description: 'Whether uploads should be public',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
