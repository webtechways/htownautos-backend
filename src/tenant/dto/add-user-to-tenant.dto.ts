import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsUUID,
  IsOptional,
  IsBoolean,
  IsObject,
  IsEmail,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';

export class AddUserToTenantDto {
  @ApiProperty({
    description: 'User ID to add to the tenant',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  @IsUUID()
  userId: string;

  @ApiProperty({
    description: 'Username for tenant email (username@subdomain.htownautos.com)',
    example: 'john.doe',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(30)
  @Matches(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, {
    message: 'Username must be lowercase alphanumeric with dots, underscores, or hyphens only',
  })
  username: string;

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
    description: 'Username for tenant email (username@subdomain.htownautos.com)',
    example: 'john.doe',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(30)
  @Matches(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, {
    message: 'Username must be lowercase alphanumeric with dots, underscores, or hyphens only',
  })
  username: string;

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
    description: 'Username for tenant email (username@subdomain.htownautos.com)',
    example: 'john.doe',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(30)
  @Matches(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, {
    message: 'Username must be lowercase alphanumeric with dots, underscores, or hyphens only',
  })
  username?: string;

  @ApiPropertyOptional({
    description: 'Phone extension number (100-999)',
    example: '101',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[1-9]\d{2}$/, {
    message: 'Extension must be between 100 and 999',
  })
  extension?: string | null;

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

export class RegisterWithInvitationDto {
  @ApiProperty({
    description: 'Secret invitation code received via email',
    example: 'abc123xyz789',
  })
  @IsString()
  code: string;

  @ApiProperty({
    description: 'Email address (must match invitation email)',
    example: 'john.doe@example.com',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'Password for the new account',
    example: 'SecurePassword123!',
  })
  @IsString()
  password: string;

  @ApiProperty({
    description: 'User first name',
    example: 'John',
  })
  @IsString()
  firstName: string;

  @ApiProperty({
    description: 'User last name',
    example: 'Doe',
  })
  @IsString()
  lastName: string;
}
