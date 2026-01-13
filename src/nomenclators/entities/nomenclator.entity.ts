import { ApiProperty } from '@nestjs/swagger';

export class NomenclatorEntity {
  @ApiProperty({
    description: 'Nomenclator UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'URL-friendly slug (unique identifier)',
    example: 'retail',
  })
  slug: string;

  @ApiProperty({
    description: 'Display title',
    example: 'Retail',
  })
  title: string;

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

  constructor(partial: Partial<NomenclatorEntity>) {
    Object.assign(this, partial);
  }
}
