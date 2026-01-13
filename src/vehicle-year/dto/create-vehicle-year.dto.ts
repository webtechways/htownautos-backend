import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min, Max, IsBoolean, IsOptional } from 'class-validator';

export class CreateVehicleYearDto {
  @ApiProperty({
    description: 'Vehicle year (4-digit integer)',
    example: 2024,
    minimum: 1900,
    maximum: 2100,
  })
  @IsInt({ message: 'Year must be an integer' })
  @Min(1900, { message: 'Year must be at least 1900' })
  @Max(2100, { message: 'Year must not exceed 2100' })
  year: number;

  @ApiProperty({
    description: 'Whether the year is active',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean({ message: 'isActive must be a boolean value' })
  isActive?: boolean = true;
}
