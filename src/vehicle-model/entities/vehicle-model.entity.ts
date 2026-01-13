import { ApiProperty } from '@nestjs/swagger';
import { VehicleModel } from '@prisma/client';

export class VehicleModelEntity implements VehicleModel {
  @ApiProperty({
    description: 'Vehicle model UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'Vehicle make UUID (foreign key)',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  makeId: string;

  @ApiProperty({
    description: 'Model name',
    example: 'Camry',
  })
  name: string;

  @ApiProperty({
    description: 'URL-friendly slug',
    example: 'camry',
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

  constructor(partial: Partial<VehicleModelEntity>) {
    Object.assign(this, partial);
  }
}
