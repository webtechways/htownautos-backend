import { ApiProperty } from '@nestjs/swagger';
import { VehicleTrim } from '@prisma/client';

export class VehicleTrimEntity implements VehicleTrim {
  @ApiProperty({
    description: 'Vehicle trim UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'Vehicle model UUID (foreign key)',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  modelId: string;

  @ApiProperty({
    description: 'Trim name',
    example: 'LE',
  })
  name: string;

  @ApiProperty({
    description: 'URL-friendly slug',
    example: 'le',
  })
  slug: string;

  @ApiProperty({
    description: 'Active status',
    example: true,
  })
  isActive: boolean;

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

  constructor(partial: Partial<VehicleTrimEntity>) {
    Object.assign(this, partial);
  }
}
