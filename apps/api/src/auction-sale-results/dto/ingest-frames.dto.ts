import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const FRAME_SOURCES = ['room', 'broadcast'] as const;
export type FrameSource = (typeof FRAME_SOURCES)[number];

/**
 * Lo que manda la extension: frames crudos, uno o en lote.
 *
 * Dos fuentes por la misma ruta, segun el modo de la extension:
 *   - `room` (por defecto): base64 del socket de sala (Solace). Una extension
 *     antigua no manda `source` y sigue funcionando igual.
 *   - `broadcast`: el texto Socket.IO del socket de difusion, ya estructurado.
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

  @IsOptional()
  @IsIn(FRAME_SOURCES)
  source?: FrameSource;

  /**
   * Cuando capturo la extension cada frame (epoch ms), en el mismo orden que
   * `frames`. Imprescindible en `broadcast`, que no trae instante de emision.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  capturedAt?: number[];

  /** Que VM lo mando, para poder aislar una maquina que mande basura. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  worker?: string;
}
