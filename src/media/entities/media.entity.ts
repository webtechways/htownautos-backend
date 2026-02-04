import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Media } from '@prisma/client';

export class MediaEntity implements Media {
  @ApiProperty({
    description: 'Media UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'Original filename',
    example: 'vehicle-front.jpg',
  })
  filename: string;

  @ApiProperty({
    description: 'Full URL of the file',
    example: 'https://bucket.s3.amazonaws.com/uploads/vehicle-front.jpg',
  })
  url: string;

  @ApiPropertyOptional({
    description: 'Relative path in storage',
    example: 'uploads/vehicles/2024/vehicle-front.jpg',
  })
  path: string | null;

  @ApiProperty({
    description: 'MIME type',
    example: 'image/jpeg',
  })
  mimeType: string;

  @ApiProperty({
    description: 'File size in bytes',
    example: 1024000,
  })
  size: number;

  @ApiPropertyOptional({
    description: 'Width in pixels (for images/videos)',
    example: 1920,
  })
  width: number | null;

  @ApiPropertyOptional({
    description: 'Height in pixels (for images/videos)',
    example: 1080,
  })
  height: number | null;

  @ApiPropertyOptional({
    description: 'Duration in seconds (for videos)',
    example: 120,
  })
  duration: number | null;

  @ApiPropertyOptional({
    description: 'Title',
    example: 'Front view',
  })
  title: string | null;

  @ApiPropertyOptional({
    description: 'Description',
    example: 'Clear front view showing the vehicle',
  })
  description: string | null;

  @ApiPropertyOptional({
    description: 'Alt text for images',
    example: '2020 Honda Accord front view',
  })
  alt: string | null;

  @ApiProperty({
    description: 'Media type',
    example: 'image',
  })
  mediaType: string;

  @ApiPropertyOptional({
    description: 'Category',
    example: 'exterior',
  })
  category: string | null;

  @ApiPropertyOptional({
    description: 'Storage provider',
    example: 's3',
  })
  storageProvider: string | null;

  @ApiPropertyOptional({
    description: 'Storage bucket name',
    example: 'htownautos-media',
  })
  storageBucket: string | null;

  @ApiPropertyOptional({
    description: 'Storage key',
    example: 'uploads/vehicles/2024/abc123.jpg',
  })
  storageKey: string | null;

  @ApiProperty({
    description: 'Whether the media is public',
    example: true,
  })
  isPublic: boolean;

  @ApiProperty({
    description: 'Whether the media is active',
    example: true,
  })
  isActive: boolean;

  @ApiPropertyOptional({
    description: 'Vehicle UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  vehicleId: string | null;

  @ApiPropertyOptional({
    description: 'Buyer UUID (private media)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  buyerId: string | null;

  @ApiPropertyOptional({
    description: 'Part UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  partId: string | null;

  @ApiPropertyOptional({
    description: 'Main image UUID for vehicle',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  mainImageId: string | null;

  @ApiPropertyOptional({
    description: 'Metadata in JSON format',
  })
  metaValue: any;

  @ApiPropertyOptional({
    description: 'Tenant UUID',
    example: '123e4567-e89b-12d3-a456-426614174003',
  })
  tenantId: string | null;

  @ApiProperty({
    description: 'Creation timestamp',
    example: '2024-01-12T10:30:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Last update timestamp',
    example: '2024-01-12T10:30:00.000Z',
  })
  updatedAt: Date;

  constructor(partial: Partial<MediaEntity>) {
    Object.assign(this, partial);
  }
}
