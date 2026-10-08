import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Partial update of the AuctionCalendarConfig singleton. */
export class UpdateCalendarConfigDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(168)
  refreshHours?: number;

  /** Intentos por sincronizacion (cada uno por un proxy distinto). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxAttempts?: number;

  /** Segundos de espera entre un intento fallido y el siguiente. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600)
  retryDelaySeconds?: number;
}
