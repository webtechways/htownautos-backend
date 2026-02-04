import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { PresignMediaDto } from './presign-media.dto';

export class ConfirmMediaDto extends PresignMediaDto {
  @ApiProperty({
    description: 'The S3 key returned from the presign endpoint',
    example: 'vehicles/abc123/2026/uuid-here/original.jpg',
  })
  @IsString()
  key: string;
}
