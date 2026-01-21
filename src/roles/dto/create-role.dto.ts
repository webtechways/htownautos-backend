
import { IsString, IsNotEmpty, IsOptional, IsArray, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRoleDto {
    @ApiProperty({ description: 'Name of the role' })
    @IsString()
    @IsNotEmpty()
    name: string;

    @ApiProperty({ description: 'Unique slug for the role (optional, auto-generated if empty)' })
    @IsString()
    @IsOptional()
    slug?: string;

    @ApiProperty({ description: 'Description of the role' })
    @IsString()
    @IsOptional()
    description?: string;

    @ApiProperty({ description: 'List of permission slugs to assign' })
    @IsArray()
    @IsString({ each: true })
    permissions: string[];
}
