import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExtraExpense } from '@prisma/client';

export class ExtraExpenseEntity implements Omit<ExtraExpense, 'price'> {
  @ApiProperty({
    description: 'Extra expense UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'Vehicle UUID (foreign key)',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  vehicleId: string;

  @ApiProperty({
    description: 'Expense description',
    example: 'New tires',
  })
  description: string;

  @ApiProperty({
    description: 'Price amount',
    example: 450.00,
    type: Number,
  })
  price: number;

  @ApiPropertyOptional({
    description: 'Receipt file UUID',
    example: '123e4567-e89b-12d3-a456-426614174002',
  })
  receiptId: string | null;

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

  @ApiPropertyOptional({
    description: 'Metadata in JSON format',
  })
  metaValue: any;

  @ApiPropertyOptional({
    description: 'Tenant UUID',
    example: '123e4567-e89b-12d3-a456-426614174003',
  })
  tenantId: string | null;

  constructor(partial: Partial<ExtraExpenseEntity> & { price?: any }) {
    Object.assign(this, partial);
    if (partial.price !== undefined) {
      this.price = Number(partial.price);
    }
  }
}
