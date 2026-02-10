import { IsString, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVehiclePartDto {
  @ApiProperty({ description: 'ID of the part from inventory' })
  @IsUUID()
  partId: string;

  @ApiPropertyOptional({ description: 'Quantity to use', default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({ description: 'Override price at time of association' })
  @IsOptional()
  @IsNumber()
  priceAtTime?: number;

  @ApiPropertyOptional({ description: 'Notes about the installation' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreatePartAndAssociateDto {
  // Part fields
  @ApiProperty({ description: 'Part name' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'OEM or custom part number' })
  @IsOptional()
  @IsString()
  partNumber?: string;

  @ApiPropertyOptional({ description: 'SKU' })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiPropertyOptional({ description: 'Part description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Condition ID' })
  @IsUUID()
  conditionId: string;

  @ApiProperty({ description: 'Status ID' })
  @IsUUID()
  statusId: string;

  @ApiPropertyOptional({ description: 'Category ID' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Cost price' })
  @IsOptional()
  @IsNumber()
  cost?: number;

  @ApiProperty({ description: 'Selling price' })
  @IsNumber()
  price: number;

  @ApiProperty({ description: 'Total quantity in inventory' })
  @IsNumber()
  @Min(1)
  quantity: number;

  // Association fields
  @ApiProperty({ description: 'Quantity to use for this vehicle' })
  @IsNumber()
  @Min(1)
  quantityToUse: number;

  @ApiPropertyOptional({ description: 'Installation notes' })
  @IsOptional()
  @IsString()
  notes?: string;
}
