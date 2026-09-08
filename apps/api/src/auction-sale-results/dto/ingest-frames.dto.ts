import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Lo que manda la extension: frames crudos en base64, uno o en lote.
 *
 * No se decodifica aqui. El parser vive en el servidor pero **detras de la
 * cola**: guardar y encolar es O(1) y no depende de que el formato de Copart
 * siga siendo el de hoy.
 */
export class IngestFramesDto {
  // 500 por peticion: la extension agrupa cada ~300ms, y un tope evita que una
  // VM atascada mande media hora de golpe.
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  frames!: string[];

  /** Que VM lo mando, para poder aislar una maquina que mande basura. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  worker?: string;
}
