import { IsNotEmpty, IsString, IsEnum } from 'class-validator';

export enum FavoriteType {
  COPART = 'copart',
  SCA_AUCTION = 'sca-auction',
}

export class ToggleFavoriteDto {
  @IsNotEmpty()
  @IsString()
  listingId: string;

  @IsNotEmpty()
  @IsEnum(FavoriteType)
  type: FavoriteType;
}
