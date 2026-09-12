import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';

/**
 * El vocabulario real de los datos de subasta, en memoria.
 *
 * Existe por dos problemas medidos que hacen inutilizable la busqueda si no se
 * tratan:
 *
 * 1. **La misma cosa escrita de varias formas.** 47 grupos de modelos conviven
 *    con mas de una grafia: `F-150`/`F150` (1.626 ventas), `CR -V`/`CRV`
 *    (1.189), `PRO MASTER`/`PROMASTER`, `MODEL  Y`/`MODEL Y`. Filtrar por una
 *    sola devuelve una fraccion de los datos.
 *
 * 2. **Las personas escriben con erratas.** "Corola" no encuentra "COROLLA", y
 *    exigir el termino exacto convierte el chat en un formulario.
 *
 * Se resuelve en memoria y no con `pg_trgm` porque hay ~1.900 modelos, ~1.150
 * marcas y ~1.800 versiones: caben de sobra, se comparan en microsegundos, y
 * evita instalar una extension y mantener indices en produccion.
 */

/** Columnas cuyo vocabulario se indexa. */
const CAMPOS = {
  make: 'make',
  model: 'model',
  trim: 'trim',
  damage: 'damageDescription',
  title: 'saleTitleType',
  color: 'color',
  state: 'locationState',
} as const;

export type VocabField = keyof typeof CAMPOS;

/** Cada cuanto se relee. El vocabulario cambia despacio; los precios no. */
const TTL_MS = 30 * 60_000;

interface Entrada {
  /** Forma canonica que se enseña: la grafia con mas ventas del grupo. */
  canonico: string;
  /** Todas las grafias del grupo, que es por lo que hay que filtrar. */
  grafias: string[];
  ventas: number;
}

/** Quita todo lo que no sea letra o numero y pasa a minusculas. */
const normaliza = (s: string): string => s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

/**
 * Distancia de edicion, cortada: si ya supera `max` se abandona.
 * Solo se usa como ultimo recurso, sobre cadenas cortas.
 */
function distancia(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let mejor = i;
    for (let j = 1; j <= b.length; j++) {
      const coste = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + coste);
      if (cur[j] < mejor) mejor = cur[j];
    }
    if (mejor > max) return max + 1; // ninguna continuacion puede mejorar
    prev = cur;
  }
  return prev[b.length];
}

@Injectable()
export class VocabularyService {
  private readonly logger = new Logger(VocabularyService.name);
  /** campo → (normalizado → entrada) */
  private cache = new Map<VocabField, Map<string, Entrada>>();
  private cargadoEn = 0;
  private cargando: Promise<void> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async asegurar(): Promise<void> {
    if (Date.now() - this.cargadoEn < TTL_MS && this.cache.size) return;
    // Una sola carga aunque lleguen varias peticiones a la vez.
    if (this.cargando) return this.cargando;
    this.cargando = this.cargar().finally(() => {
      this.cargando = null;
    });
    return this.cargando;
  }

  private async cargar(): Promise<void> {
    const nuevo = new Map<VocabField, Map<string, Entrada>>();
    for (const [campo, columna] of Object.entries(CAMPOS) as [VocabField, string][]) {
      const filas = (await this.prisma.$queryRawUnsafe(
        `SELECT "${columna}"::text AS valor, count(*) AS n
           FROM auction_sale_results
          WHERE "${columna}" IS NOT NULL AND "${columna}"::text <> ''
          GROUP BY "${columna}"`,
      )) as { valor: string; n: bigint }[];

      const grupos = new Map<string, Entrada>();
      for (const f of filas) {
        const k = normaliza(f.valor);
        if (!k) continue;
        const ventas = Number(f.n);
        const ya = grupos.get(k);
        if (!ya) {
          grupos.set(k, { canonico: f.valor, grafias: [f.valor], ventas });
        } else {
          ya.grafias.push(f.valor);
          ya.ventas += ventas;
          // La grafia canonica es la que mas ventas tiene, que es la que el
          // usuario reconoce.
          const ventasActual = Number(
            filas.find((x) => x.valor === ya.canonico)?.n ?? 0,
          );
          if (ventas > ventasActual) ya.canonico = f.valor;
        }
      }
      nuevo.set(campo, grupos);
    }
    this.cache = nuevo;
    this.cargadoEn = Date.now();
    this.logger.log(
      `[Vocab] ${[...nuevo].map(([c, m]) => `${c}:${m.size}`).join(' ')}`,
    );
  }

  /**
   * Busca lo que escribio el usuario. Por orden: coincidencia exacta
   * normalizada, prefijo, subcadena y, solo si nada de eso da resultado,
   * distancia de edicion para tolerar erratas.
   */
  async resolve(
    campo: VocabField,
    texto: string,
    limite = 5,
  ): Promise<{ valor: string; grafias: string[]; ventas: number; exacto: boolean }[]> {
    await this.asegurar();
    const grupos = this.cache.get(campo);
    const aguja = normaliza(texto);
    if (!grupos || !aguja) return [];

    const salida = (e: Entrada, exacto: boolean) => ({
      valor: e.canonico,
      grafias: e.grafias,
      ventas: e.ventas,
      exacto,
    });

    const exacta = grupos.get(aguja);
    if (exacta) return [salida(exacta, true)];

    const prefijo: Entrada[] = [];
    const dentro: Entrada[] = [];
    for (const [k, e] of grupos) {
      if (k.startsWith(aguja)) prefijo.push(e);
      else if (k.includes(aguja)) dentro.push(e);
    }
    const porVentas = (a: Entrada, b: Entrada) => b.ventas - a.ventas;
    if (prefijo.length || dentro.length) {
      return [...prefijo.sort(porVentas), ...dentro.sort(porVentas)]
        .slice(0, limite)
        .map((e) => salida(e, false));
    }

    // Erratas. El margen crece con la longitud pero se queda corto: con 2
    // ediciones sobre una palabra de 6 letras ya se confunden modelos distintos.
    const max = aguja.length <= 4 ? 1 : aguja.length <= 8 ? 2 : 3;
    const cercanos: { e: Entrada; d: number }[] = [];
    for (const [k, e] of grupos) {
      const d = distancia(aguja, k, max);
      if (d <= max) cercanos.push({ e, d });
    }
    return cercanos
      .sort((a, b) => a.d - b.d || b.e.ventas - a.e.ventas)
      .slice(0, limite)
      .map((c) => salida(c.e, false));
  }

  /**
   * Expande cada valor a TODAS sus grafias en los datos.
   *
   * Es lo que evita que una pregunta por la F-150 devuelva dos filas —una con
   * 87 ventas y otra con 1.539— en vez de una respuesta.
   */
  async expand(campo: VocabField, valores: string[]): Promise<string[]> {
    await this.asegurar();
    const grupos = this.cache.get(campo);
    if (!grupos) return valores;
    const salida = new Set<string>();
    for (const v of valores) {
      const e = grupos.get(normaliza(v));
      if (e) e.grafias.forEach((g) => salida.add(g));
      else salida.add(v); // desconocido: se respeta tal cual
    }
    return [...salida];
  }
}
