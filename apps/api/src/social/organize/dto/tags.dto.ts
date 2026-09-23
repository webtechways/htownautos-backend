import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsHexColor, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTagDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @ApiProperty({ example: '#6366F1' })
  @IsHexColor()
  color!: string;
}

export class UpdateTagDto extends PartialType(CreateTagDto) {}
