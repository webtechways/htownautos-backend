import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsUUID,
  IsOptional,
  IsBoolean,
  IsObject,
  IsEmail,
} from 'class-validator';

export class AddUserToTenantDto {
  @ApiProperty({
    description: 'User ID to add to the tenant',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  @IsUUID()
  userId: string;

  @ApiProperty({
    description: 'Role ID to assign to the user in this tenant',
    example: '123e4567-e89b-12d3-a456-426614174002',
  })
  @IsUUID()
  roleId: string;

  @ApiPropertyOptional({
    description: 'Custom permissions/overrides for this user in this tenant',
    example: { canExportData: true, maxDealsPerDay: 10 },
  })
  @IsOptional()
  @IsObject()
  permissions?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Whether the user is active in this tenant',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class InviteUserToTenantDto {
  @ApiProperty({
    description: 'Email of the user to invite',
    example: 'john.doe@example.com',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'Role ID to assign to the user in this tenant',
    example: '123e4567-e89b-12d3-a456-426614174002',
  })
  @IsUUID()
  roleId: string;

  @ApiPropertyOptional({
    description: 'Custom permissions/overrides for this user in this tenant',
    example: { canExportData: true },
  })
  @IsOptional()
  @IsObject()
  permissions?: Record<string, any>;
}

export class UpdateTenantUserDto {
  @ApiPropertyOptional({
    description: 'New role ID for the user',
    example: '123e4567-e89b-12d3-a456-426614174002',
  })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional({
    description: 'Custom permissions/overrides for this user',
    example: { canExportData: false },
  })
  @IsOptional()
  @IsObject()
  permissions?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Whether the user is active in this tenant',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AcceptInvitationDto {
  @ApiProperty({
    description: 'Secret invitation code received via email',
    example: 'abc123xyz789',
  })
  @IsString()
  code: string;
}

export class ResendInvitationDto {
  @ApiProperty({
    description: 'User ID to resend invitation to',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  @IsUUID()
  userId: string;
}
