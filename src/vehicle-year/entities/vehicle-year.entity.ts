import { ApiProperty } from '@nestjs/swagger';

export class VehicleYearEntity {
  @ApiProperty({
    description: 'Unique identifier',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'Vehicle year',
    example: 2024,
  })
  year: number;

  @ApiProperty({
    description: 'Whether the year is active',
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

  constructor(partial: Partial<VehicleYearEntity>) {
    Object.assign(this, partial);
  }
}
