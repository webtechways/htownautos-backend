import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsBoolean,
  IsEnum,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export enum YearFilterOperator {
  EQUAL = 'eq',
  GREATER_THAN = 'gt',
  LESS_THAN = 'lt',
  GREATER_THAN_OR_EQUAL = 'gte',
  LESS_THAN_OR_EQUAL = 'lte',
}

export class QueryVehicleYearDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Filter by year value',
    example: 2020,
    minimum: 1900,
    maximum: 2100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Year must be a 4-digit integer' })
  @Min(1900, { message: 'Year must be at least 1900' })
  @Max(2100, { message: 'Year must not exceed 2100' })
  year?: number;

  @ApiPropertyOptional({
    description: 'Year filter operator',
    enum: YearFilterOperator,
    default: YearFilterOperator.EQUAL,
    example: YearFilterOperator.GREATER_THAN,
  })
  @IsOptional()
  @IsEnum(YearFilterOperator, {
    message: `Operator must be one of: ${Object.values(YearFilterOperator).join(', ')}`,
  })
  operator?: YearFilterOperator = YearFilterOperator.EQUAL;

  @ApiPropertyOptional({
    description: 'Filter by active status',
    example: true,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'isActive must be a boolean value' })
  isActive?: boolean;
}
