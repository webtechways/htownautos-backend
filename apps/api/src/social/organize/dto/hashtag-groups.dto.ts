import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateHashtagGroupDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  /** Space-separated, each starting with # (kept as free text — platforms vary too much to validate per-tag). */
  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  hashtags!: string;
}

export class UpdateHashtagGroupDto extends PartialType(CreateHashtagGroupDto) {}
