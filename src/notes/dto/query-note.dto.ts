import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryNoteDto {
  @ApiPropertyOptional({ description: 'Filter by buyer ID' })
  @IsUUID()
  @IsOptional()
  buyerId?: string;

  @ApiPropertyOptional({ description: 'Filter by vehicle ID' })
  @IsUUID()
  @IsOptional()
  vehicleId?: string;

  @ApiPropertyOptional({ description: 'Filter by deal ID' })
  @IsUUID()
  @IsOptional()
  dealId?: string;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;
}
