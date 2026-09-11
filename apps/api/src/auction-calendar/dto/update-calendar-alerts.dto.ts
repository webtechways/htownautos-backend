import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/** Avisos por chat antes de que empiece una subasta del calendario. */
export class UpdateCalendarAlertsDto {
  @IsOptional()
  @IsBoolean()
  alertsEnabled?: boolean;

  /**
   * Minutos de antelacion. El maximo son 24 horas: mas alla deja de ser un
   * aviso de "va a empezar" y se convierte en la agenda del dia.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  alertMinutesBefore?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  alertChannelIds?: string[];

  @IsOptional()
  @IsBoolean()
  alertOnlyWithAgent?: boolean;
}
