import { ApiProperty } from '@nestjs/swagger';
import { VehicleMake } from '@prisma/client';

export class VehicleMakeEntity implements VehicleMake {
  @ApiProperty({
    description: 'Vehicle make UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'Vehicle year UUID (foreign key)',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  yearId: string;

  @ApiProperty({
    description: 'Make name',
    example: 'Toyota',
  })
  name: string;

  @ApiProperty({
    description: 'URL-friendly slug',
    example: 'toyota',
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

  constructor(partial: Partial<VehicleMakeEntity>) {
    Object.assign(this, partial);
  }
}
