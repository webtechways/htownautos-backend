import { IsArray, IsOptional, IsString } from 'class-validator';

export class RetryFailedDto {
  /**
   * Lotes concretos a reencolar. Sin este campo se reencolan **todos** los
   * fallidos, que es el caso de "Retry all".
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  lots?: string[];

  /** COPART | IAAI. Sin el campo, los de las dos subastas. */
  @IsOptional()
  @IsString()
  auction?: string;
}
