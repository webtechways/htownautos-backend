import { IsNotEmpty, IsString, IsEnum } from 'class-validator';

export enum FavoriteType {
  COPART = 'copart',
  /** IAAI lot, by stock number (iaai_favorites). */
  IAAI = 'iaai',
}

export class ToggleFavoriteDto {
  @IsNotEmpty()
  @IsString()
  listingId: string;

  @IsNotEmpty()
  @IsEnum(FavoriteType)
  type: FavoriteType;
}
