import { Injectable, Logger } from '@nestjs/common';
import { StatsService, BREAKDOWN_FIELDS, type BreakdownField } from '../auction-sale-results/stats.service';
import { VocabularyService, type VocabField } from '../auction-sale-results/vocabulary.service';
import { QueryStatsDto } from '../auction-sale-results/dto/query-stats.dto';

/**
 * Las herramientas que el modelo puede llamar.
 *
 * El modelo **no escribe SQL**. Elige una funcion y unos filtros; la consulta
 * la hace este codigo. Generar SQL contra una base de 1,5 millones de filas
 * compartida entre dev y produccion no compensa: una consulta sin limites ni
 * indices la tumba, y un error de prompt basta para provocarla.
 *
 * Todos los filtros pasan por `QueryStatsDto` y `StatsService`, que es el mismo
 * camino que usa la pantalla de Stats. Asi el chat y la rejilla no pueden
 * discrepar sobre lo que significa un filtro.
 */

/** Filtros que el modelo puede fijar. Subconjunto deliberado del DTO completo. */
const FILTROS_SCHEMA = {
  type: 'object',
  properties: {
    make: { type: 'array', items: { type: 'string' }, description: 'Marcas, tal como aparecen en los datos (ej. TOYOTA)' },
    model: { type: 'array', items: { type: 'string' }, description: 'Modelos, tal como aparecen en los datos (ej. CAMRY)' },
    trim: { type: 'array', items: { type: 'string' } },
    damageDescription: { type: 'array', items: { type: 'string' }, description: 'Daño principal (ej. FRONT END, REAR END, ROLLOVER)' },
    titleCategory: {
      type: 'array',
      items: { type: 'string', enum: ['clean', 'salvage', 'nonrepairable', 'unknown'] },
      description: 'Categoria de titulo',
    },
    locationState: { type: 'array', items: { type: 'string' }, description: 'Estado de dos letras (ej. TX)' },
    color: { type: 'array', items: { type: 'string' } },
    yearMin: { type: 'number' },
    yearMax: { type: 'number' },
    odometerMin: { type: 'number' },
    odometerMax: { type: 'number' },
    runsDrives: { type: 'string', description: 'Solo los que arrancan y andan' },
  },
} as const;

export const TOOL_DEFS = [
  {
    type: 'function' as const,
    function: {
      name: 'resolver_valores',
      description:
        'Traduce lo que escribio el usuario a los valores que existen en los datos. ' +
        'USA ESTO UNA SOLA VEZ ANTES de filtrar, resolviendo TODOS los campos que necesites en la misma llamada. ' +
        'Tolera erratas y distintas grafias, y ya agrupa las variantes: al filtrar usa el campo `valor` tal cual. ' +
        'Si `exacto` es false pero hay un unico resultado claro, USALO y menciona la correccion de paso; no preguntes al usuario.',
      parameters: {
        type: 'object',
        properties: {
          consultas: {
            type: 'array',
            description: 'Un elemento por cada campo a resolver',
            items: {
              type: 'object',
              properties: {
                campo: { type: 'string', enum: ['make', 'model', 'trim', 'damage', 'title', 'color', 'state'] },
                texto: { type: 'string', description: 'Lo que escribio el usuario' },
              },
              required: ['campo', 'texto'],
            },
          },
        },
        required: ['consultas'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'estadisticas_de_precio',
      description:
        'Distribucion del precio final de venta para unos filtros: mediana, percentiles 25 y 75, minimo, maximo y media, ' +
        'mas el kilometraje mediano y el tamaño de la muestra. Es la herramienta principal para "cuanto se paga por X". ' +
        'Usa la MEDIANA como respuesta y los percentiles como rango habitual.',
      parameters: { ...FILTROS_SCHEMA },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'desglose',
      description:
        'Reparte los resultados por una dimension y devuelve, para cada grupo, cuantas ventas hay y la mediana de precio. ' +
        'Responde preguntas del tipo "que año sale mas a cuenta" o "en que estados se paga mas" sin pedir una consulta por grupo.',
      parameters: {
        type: 'object',
        properties: {
          ...FILTROS_SCHEMA.properties,
          por: { type: 'string', enum: BREAKDOWN_FIELDS, description: 'Dimension por la que agrupar' },
        },
        required: ['por'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'ejemplos_de_ventas',
      description:
        'Devuelve ventas concretas con su numero de lote, para que la respuesta se pueda comprobar. ' +
        'Usalo cuando el usuario pida ejemplos o cuando convenga respaldar una cifra con casos reales.',
      parameters: {
        type: 'object',
        properties: {
          ...FILTROS_SCHEMA.properties,
          limite: { type: 'number', description: 'Cuantas devolver (maximo 10)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'cobertura_de_datos',
      description:
        'Que periodo cubren los datos de ventas y cuantas hay en total. ' +
        'Llamalo SIEMPRE que la pregunta sea sobre tendencias, evolucion o comparaciones entre periodos, ' +
        'antes de responder nada.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

@Injectable()
export class AiChatToolsService {
  private readonly logger = new Logger(AiChatToolsService.name);

  constructor(
    private readonly stats: StatsService,
    private readonly vocab: VocabularyService,
  ) {}

  /** Pasa los argumentos del modelo al DTO que entiende StatsService. */
  private async toDto(args: any): Promise<QueryStatsDto> {
    const dto = new QueryStatsDto();
    const listas = ['make', 'model', 'trim', 'damageDescription', 'titleCategory', 'locationState', 'color'];
    for (const k of listas) {
      if (Array.isArray(args?.[k]) && args[k].length) (dto as any)[k] = args[k].map(String);
    }

    // Cada valor se expande a TODAS sus grafias en los datos. Sin esto, filtrar
    // por "F150" deja fuera las 87 ventas guardadas como "F-150" y la respuesta
    // sale partida en dos filas que al usuario no le dicen nada.
    // `titleCategory` no se toca: no es vocabulario, es una categoria derivada.
    const expandibles: [string, VocabField][] = [
      ['make', 'make'], ['model', 'model'], ['trim', 'trim'],
      ['damageDescription', 'damage'], ['locationState', 'state'], ['color', 'color'],
    ];
    for (const [clave, campo] of expandibles) {
      const v = (dto as any)[clave] as string[] | undefined;
      if (v?.length) (dto as any)[clave] = await this.vocab.expand(campo, v);
    }
    for (const k of ['yearMin', 'yearMax', 'odometerMin', 'odometerMax']) {
      const v = Number(args?.[k]);
      if (Number.isFinite(v)) (dto as any)[k] = v;
    }
    if (typeof args?.runsDrives === 'string' && args.runsDrives) dto.runsDrives = args.runsDrives;
    return dto;
  }

  /**
   * Ejecuta una herramienta. Nunca lanza: un fallo vuelve al modelo como texto
   * para que lo explique, en vez de romper la conversacion entera.
   */
  async run(nombre: string, args: any): Promise<unknown> {
    try {
      switch (nombre) {
        case 'resolver_valores': {
          const consultas: { campo: VocabField; texto: string }[] = Array.isArray(args?.consultas)
            ? args.consultas
            : // Compatibilidad con la forma antigua de un solo campo.
              [{ campo: args?.campo, texto: args?.texto }];

          const resueltos = await Promise.all(
            consultas.map(async (c) => {
              const encontrados = await this.vocab.resolve(c.campo, String(c.texto ?? ''));
              return {
                campo: c.campo,
                busco: c.texto,
                // `valor` ya es la grafia canonica; al filtrar se expanden todas.
                valores: encontrados.map((e) => ({
                  valor: e.valor,
                  ventas: e.ventas,
                  exacto: e.exacto,
                  ...(e.grafias.length > 1 ? { variantesEnDatos: e.grafias } : {}),
                })),
              };
            }),
          );

          const vacios = resueltos.filter((r) => r.valores.length === 0).map((r) => r.busco);
          return {
            resueltos,
            ...(vacios.length
              ? { nota: `Sin coincidencias para: ${vacios.join(', ')}. No inventes un valor: dilo y pide que concreten.` }
              : {}),
          };
        }

        case 'estadisticas_de_precio': {
          const r = await this.stats.priceStats(await this.toDto(args));
          return {
            ...r,
            nota: r.muestra === 0
              ? 'Sin ventas con estos filtros. No estimes un precio.'
              : r.suficiente
                ? null
                : `Solo ${r.muestra} venta(s). Muestra insuficiente: dilo claramente y no des la mediana como si fuera fiable.`,
          };
        }

        case 'desglose': {
          const { por, ...filtros } = args ?? {};
          if (!BREAKDOWN_FIELDS.includes(por)) return { error: `dimension no valida: ${por}` };
          const grupos = await this.stats.breakdown(await this.toDto(filtros), por);
          return { por, grupos, nota: 'Los grupos marcados como no suficientes tienen muestra pobre; no los presentes como dato firme.' };
        }

        case 'ejemplos_de_ventas': {
          const dto = await this.toDto(args);
          dto.limit = Math.min(Math.max(Number(args?.limite) || 5, 1), 10);
          dto.sortBy = 'saleDate';
          dto.sortOrder = 'desc';
          const r: any = await this.stats.search(dto);
          return {
            total: r.meta?.total ?? 0,
            ejemplos: (r.data ?? []).map((v: any) => ({
              lote: v.lot,
              año: v.year,
              marca: v.make,
              modelo: v.model,
              version: v.trim,
              precioFinal: v.finalBid,
              odometro: v.odometer,
              daño: v.damageDescription,
              titulo: v.saleTitleType,
              estado: v.locationState,
            })),
          };
        }

        case 'cobertura_de_datos': {
          const c = await this.stats.coverage();
          const dias =
            c.desde && c.hasta
              ? Math.max(1, Math.round((c.hasta.getTime() - c.desde.getTime()) / 86_400_000))
              : 0;
          return {
            ...c,
            diasCubiertos: dias,
            nota: `Los datos cubren ${dias} dia(s). No respondas preguntas de tendencia o evolucion mas alla de ese periodo.`,
          };
        }

        default:
          return { error: `herramienta desconocida: ${nombre}` };
      }
    } catch (err) {
      this.logger.error(`[AiChat] herramienta ${nombre}: ${(err as Error).message}`);
      return { error: 'La consulta fallo. Dilo en vez de responder con un numero.' };
    }
  }
}
