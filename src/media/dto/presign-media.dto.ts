import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsInt, Min, Max, Matches } from 'class-validator';
import { CreateMediaDto } from './create-media.dto';

export class PresignMediaDto extends CreateMediaDto {
  @ApiProperty({ description: 'Original filename', example: 'photo.jpg' })
  @IsString()
  filename: string;

  @ApiProperty({ description: 'MIME type of the file', example: 'image/jpeg' })
  @IsString()
  @Matches(
    /^(image\/(jpeg|png|webp|gif)|application\/pdf|video\/(mp4|quicktime))$/,
    {
      message:
        'Allowed: image/jpeg, image/png, image/webp, image/gif, application/pdf, video/mp4, video/quicktime',
    },
  )
  contentType: string;

  @ApiProperty({ description: 'File size in bytes', example: 1024000 })
  @IsInt()
  @Min(1)
  @Max(10 * 1024 * 1024) // 10 MB
  fileSize: number;
}
