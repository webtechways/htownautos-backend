import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExtraExpense, Media } from '@prisma/client';

export class ExtraExpenseEntity implements Omit<ExtraExpense, 'price'> {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174001' })
  vehicleId: string;

  @ApiProperty({ example: 'New tires' })
  description: string;

  @ApiProperty({ example: 450.0, type: Number })
  price: number;

  @ApiPropertyOptional({ description: 'Receipt images', type: 'array' })
  receipts?: Media[];

  @ApiProperty({ example: '2024-01-12T10:30:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2024-01-12T10:30:00.000Z' })
  updatedAt: Date;

  @ApiPropertyOptional()
  metaValue: any;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174003' })
  tenantId: string | null;

  constructor(partial: Partial<ExtraExpenseEntity> & { price?: any }) {
    Object.assign(this, partial);
    if (partial.price !== undefined) {
      this.price = Number(partial.price);
    }
  }
}
