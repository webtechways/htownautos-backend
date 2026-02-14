import { IsString, IsOptional, IsBoolean, IsEnum, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum SearchType {
  STATE = 'state',
  AREA_CODE = 'areaCode',
  TOLL_FREE = 'tollFree',
}

export enum NumberType {
  LOCAL = 'local',
  TOLL_FREE = 'tollFree',
}

export class SearchPhoneNumbersDto {
  @ApiProperty({
    enum: SearchType,
    description: 'Search by state, area code, or toll-free',
    example: 'state',
  })
  @IsEnum(SearchType)
  type: SearchType;

  @ApiPropertyOptional({
    description: 'State code (e.g., TX) or area code (e.g., 713). Not required for toll-free.',
    example: 'TX',
  })
  @IsOptional()
  @IsString()
  value?: string;

  @ApiPropertyOptional({
    enum: NumberType,
    description: 'Type of number to search: local or tollFree',
    example: 'local',
    default: 'local',
  })
  @IsOptional()
  @IsEnum(NumberType)
  numberType?: NumberType;
}

export class PurchasePhoneNumberDto {
  @ApiProperty({
    description: 'Phone number in E.164 format',
    example: '+15551234567',
  })
  @IsString()
  @Matches(/^\+1\d{10}$/, { message: 'Phone number must be in E.164 format (e.g., +15551234567)' })
  phoneNumber: string;

  @ApiPropertyOptional({
    description: 'Friendly name for the phone number',
    example: 'Main Sales Line',
  })
  @IsOptional()
  @IsString()
  friendlyName?: string;

  @ApiPropertyOptional({
    description: 'Whether this is the primary number for the tenant',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class UpdatePhoneNumberDto {
  @ApiPropertyOptional({
    description: 'Friendly name for the phone number',
    example: 'Support Line',
  })
  @IsOptional()
  @IsString()
  friendlyName?: string;

  @ApiPropertyOptional({
    description: 'Whether this is the primary number for the tenant',
  })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional({
    description: 'Whether the number is active',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
