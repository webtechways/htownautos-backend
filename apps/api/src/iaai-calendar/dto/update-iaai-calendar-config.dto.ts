import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateIaaiCalendarConfigDto {
  /** Cada cuantas horas se refresca (0 = solo a mano). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(168)
  refreshHours?: number;

  /** Lanes candidatas por sede (a, b, c…). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(26)
  lanesPerBranch?: number;

  @IsOptional()
  @IsBoolean()
  useProxy?: boolean;
}
