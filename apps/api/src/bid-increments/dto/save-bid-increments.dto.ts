import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNumber, Min, ValidateNested } from 'class-validator';

export class BidIncrementRowDto {
  @IsNumber()
  @Min(0)
  fromPrice!: number;

  @IsNumber()
  @Min(0.01)
  increment!: number;
}

/** La tabla entera: se guarda de una vez, como la edita la pantalla. */
export class SaveBidIncrementsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BidIncrementRowDto)
  rows!: BidIncrementRowDto[];
}
