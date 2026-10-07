import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString } from 'class-validator';

/** Estado a mano para una o varias subastas del calendario (Copart o IAAI). */
export class SetCalendarStatusDto {
  @ApiProperty({ type: [String], description: 'Ids de las subastas (hasta 500)' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsString({ each: true })
  ids!: string[];

  @ApiProperty({ enum: ['live', 'upcoming', 'ended', 'auto'], description: 'auto = quitar el estado manual' })
  @IsIn(['live', 'upcoming', 'ended', 'auto'])
  status!: 'live' | 'upcoming' | 'ended' | 'auto';
}
