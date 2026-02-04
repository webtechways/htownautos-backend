import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsUUID,
  IsOptional,
  MaxLength,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class CreateTitleDto {
  @ApiPropertyOptional({ description: 'ROS / Title number' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  titleNumber?: string;

  @ApiPropertyOptional({ description: 'Title state (e.g., TX, CA, FL)' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  titleState?: string;

  @ApiPropertyOptional({ description: 'Title status ID (nomenclator)' })
  @IsOptional()
  @IsUUID('4', { message: 'titleStatusId must be a valid UUID' })
  @Transform(({ value }) => (value === '' || value === null ? undefined : value))
  titleStatusId?: string;

  @ApiPropertyOptional({ description: 'Brand status ID (nomenclator)' })
  @IsOptional()
  @IsUUID('4', { message: 'brandStatusId must be a valid UUID' })
  @Transform(({ value }) => (value === '' || value === null ? undefined : value))
  brandStatusId?: string;

  @ApiPropertyOptional({ description: 'Title received date' })
  @IsOptional()
  @Type(() => Date)
  titleReceivedDate?: Date;

  @ApiPropertyOptional({ description: 'Title issue date' })
  @IsOptional()
  @Type(() => Date)
  titleIssueDate?: Date;

  @ApiPropertyOptional({ description: 'Title sent/out date' })
  @IsOptional()
  @Type(() => Date)
  titleSentDate?: Date;

  @ApiPropertyOptional({ description: 'Title transferred date' })
  @IsOptional()
  @Type(() => Date)
  transferDate?: Date;

  @ApiPropertyOptional({ description: 'Title application number' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  titleAppNumber?: string;

  @ApiPropertyOptional({ description: 'Front image ID (media)', nullable: true })
  @IsOptional()
  @IsUUID('4', { message: 'frontImageId must be a valid UUID' })
  @Transform(({ value }) => (value === '' ? null : value))
  frontImageId?: string | null;

  @ApiPropertyOptional({ description: 'Back image ID (media)', nullable: true })
  @IsOptional()
  @IsUUID('4', { message: 'backImageId must be a valid UUID' })
  @Transform(({ value }) => (value === '' ? null : value))
  backImageId?: string | null;
}
