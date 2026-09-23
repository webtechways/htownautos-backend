import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { PUBLISHABLE_PLATFORMS } from './platforms';

export class CreateIdeaDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  content?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  mediaIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  tagIds?: string[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  groupId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  position?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  sourceUrl?: string;
}

export class UpdateIdeaDto extends PartialType(CreateIdeaDto) {}

export class MoveIdeaDto {
  /** Required but nullable — null moves the idea to the "Unassigned" column. */
  @ApiProperty({ nullable: true })
  @ValidateIf((_o, value) => value !== null)
  @IsUUID()
  groupId!: string | null;

  @ApiProperty()
  @IsNumber()
  position!: number;
}

export class IdeaListQueryDto {
  /** Idea group id, or the literal "unassigned" for groupId = null. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  groupId?: string;

  /** CSV of tag ids. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tagIds?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  q?: string;
}

export class GenerateIdeasDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  prompt!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  count?: number;

  @ApiPropertyOptional({ enum: PUBLISHABLE_PLATFORMS })
  @IsOptional()
  @IsIn(PUBLISHABLE_PLATFORMS)
  platform?: (typeof PUBLISHABLE_PLATFORMS)[number];
}
