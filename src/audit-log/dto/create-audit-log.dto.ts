import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsObject } from 'class-validator';

export class CreateAuditLogDto {
  @ApiProperty({ description: 'Action performed (e.g., print, download)' })
  @IsString()
  action: string;

  @ApiProperty({ description: 'Resource type (e.g., vehicle-pdf)' })
  @IsString()
  resource: string;

  @ApiPropertyOptional({ description: 'Vehicle ID if applicable' })
  @IsString()
  @IsOptional()
  vehicleId?: string;

  @ApiPropertyOptional({ description: 'Buyer ID if applicable' })
  @IsString()
  @IsOptional()
  buyerId?: string;

  @ApiPropertyOptional({ description: 'Deal ID if applicable' })
  @IsString()
  @IsOptional()
  dealId?: string;

  @ApiPropertyOptional({ description: 'Log level' })
  @IsString()
  @IsOptional()
  level?: string;

  @ApiPropertyOptional({ description: 'Whether PII was accessed' })
  @IsBoolean()
  @IsOptional()
  piiAccessed?: boolean;

  @ApiPropertyOptional({ description: 'Additional details' })
  @IsObject()
  @IsOptional()
  details?: Record<string, any>;
}
