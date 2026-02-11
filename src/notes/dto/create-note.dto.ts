import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsString, IsUUID, IsOptional, IsNotEmpty } from 'class-validator';

export class CreateNoteDto {
  @ApiProperty({ description: 'HTML content of the note' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({ description: 'Buyer ID if note is related to a buyer' })
  @IsUUID()
  @IsOptional()
  buyerId?: string;

  @ApiPropertyOptional({ description: 'Vehicle ID if note is related to a vehicle' })
  @IsUUID()
  @IsOptional()
  vehicleId?: string;

  @ApiPropertyOptional({ description: 'Deal ID if note is related to a deal' })
  @IsUUID()
  @IsOptional()
  dealId?: string;
}

export class UpdateNoteDto extends PartialType(CreateNoteDto) {}
