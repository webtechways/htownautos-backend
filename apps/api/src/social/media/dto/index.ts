import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class MediaUploadUrlDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  fileName: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  mimeType: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  sizeBytes: number;
}

export class RegisterMediaDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  key: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  fileName: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  mimeType: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  sizeBytes: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  height?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  durationSec?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  altText?: string;

  @ApiPropertyOptional({ description: 'Key of a poster frame the browser captured and uploaded the same way.' })
  @IsOptional()
  @IsString()
  thumbnailKey?: string;
}

export class PatchMediaDto {
  @ApiProperty()
  @IsString()
  altText: string;
}
