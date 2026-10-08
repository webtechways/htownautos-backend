import { Type } from 'class-transformer';
import { IsInt, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

/** Lo que la extension leyo de un calendario (o por que no pudo). */
class CalendarReadDto {
  /** Estado HTTP que vio el navegador. */
  @IsOptional() @IsInt()
  status?: number | null;

  /** Si no pudo leerlo: el motivo (bloqueo, pagina distinta, timeout…). */
  @IsOptional() @IsString() @MaxLength(2000)
  error?: string | null;

  /** Cuanto tardo, en ms. */
  @IsOptional() @IsInt()
  ms?: number | null;
}

export class CopartCalendarReadDto extends CalendarReadDto {
  /** La respuesta de /en/data/v2/auction-calendar, tal cual. */
  @IsOptional() @IsObject()
  json?: Record<string, unknown> | null;
}

export class IaaiCalendarReadDto extends CalendarReadDto {
  /** `<script id="locationsListVM">…</script>` de iaai.com/branchlocations. */
  @IsOptional() @IsString() @MaxLength(4_000_000)
  html?: string | null;
}

/** Un envio de la extension de calendarios: uno o los dos. */
export class IngestCalendarsDto {
  @IsString() @MaxLength(120)
  worker!: string;

  @IsOptional() @ValidateNested() @Type(() => CopartCalendarReadDto)
  copart?: CopartCalendarReadDto;

  @IsOptional() @ValidateNested() @Type(() => IaaiCalendarReadDto)
  iaai?: IaaiCalendarReadDto;
}
