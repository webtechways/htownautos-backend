import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { allKnownCodes, codesForTitleCategories } from '@htownautos/common';
import { TitleMappingService } from '../title-mapping/title-mapping.service';
import { VocabularyService } from '../auction-sale-results/vocabulary.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';

/** Por debajo de esto una mediana no dice nada: la grafica lo avisa. */
export const MUESTRA_MINIMA = 10;
/** Las consultas sin filtro recorren toda la tabla (~1,3 s): se reutilizan. */
const CACHE_MS = 10 * 60_000;
const CACHE_MAX = 500;

const r = (v: unknown): number | null => (v === null || v === undefined ? null : Math.round(Number(v)));

/** YYYYMMDD de hoy en Houston, que es la fecha con la que se guardan las ventas. */
export function houstonToday(now = new Date()): number {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now)
    .replace(/-/g, '');
  return Number(p);
}

/** YYYYMMDD ± dias, sin zonas: se opera en UTC sobre la fecha civil. */
export function shiftYmd(ymd: number, days: number): number {
  const y = Math.floor(ymd / 10000), m = Math.floor((ymd % 10000) / 100) - 1, d = ymd % 100;
  const t = new Date(Date.UTC(y, m, d + days));
  return t.getUTCFullYear() * 10000 + (t.getUTCMonth() + 1) * 100 + t.getUTCDate();
}

/** Paso "redondo" (1, 2, 2.5, 5 × 10^k) para que el histograma tenga cubos legibles. */
export function niceStep(span: number, bins: number): number {
  const raw = Math.max(span / Math.max(bins, 1), 1);
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

export interface TrendPoint {
  /** Inicio del cubo, YYYY-MM-DD. */
  t: string;
  n: number;
  p25: number | null;
  p50: number | null;
  p75: number | null;
}

/**
 * Agregados del mercado para las graficas de PrecioTope.
 *
 * Mismo vocabulario de filtros que `/auction-sale-results` (marca, modelo,
 * años, categoria de titulo…), pero cada respuesta es una serie ya agregada:
 * nunca salen filas sueltas ni el precio de un lote concreto.
 */
@Injectable()
export class MarketAnalyticsService {
  private readonly cache = new Map<string, { at: number; value: unknown }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly titleMapping: TitleMappingService,
    private readonly vocab: VocabularyService,
  ) {}

  private async cached<T>(widget: string, dto: AnalyticsQueryDto, fn: () => Promise<T>): Promise<T> {
    const key = `${widget}:${JSON.stringify(dto)}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
    const value = await fn();
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  /** Nombre de tabla de una lista cerrada: nunca sale de lo que manda el usuario. */
  private table(dto: AnalyticsQueryDto): Prisma.Sql {
    const s = dto.source ?? [];
    const c = s.includes('copart'), i = s.includes('iaai');
    return Prisma.raw(c && i ? 'sale_results_all' : i ? 'iaai_sale_results' : 'auction_sale_results');
  }

  /** WHERE parametrizado con los filtros; siempre exige precio final. */
  async where(dto: AnalyticsQueryDto, extra: Prisma.Sql[] = []): Promise<Prisma.Sql> {
    const and: Prisma.Sql[] = [Prisma.sql`"finalBid" IS NOT NULL AND "finalBid" > 0`, ...extra];
    const inList = (col: string, vals?: string[]) => {
      if (vals?.length) and.push(Prisma.sql`${Prisma.raw(`"${col}"`)} IN (${Prisma.join(vals)})`);
    };
    const inListExpand = async (col: string, campo: 'make' | 'model', vals?: string[]) => {
      if (!vals?.length) return;
      const expandidos = [...new Set([...(await this.vocab.expand(campo, vals)), ...vals.map((v) => v.toUpperCase())])];
      and.push(Prisma.sql`${Prisma.raw(`"${col}"`)} IN (${Prisma.join(expandidos)})`);
    };
    await inListExpand('make', 'make', dto.make);
    await inListExpand('model', 'model', dto.model);
    inList('locationState', dto.locationState);
    inList('damageDescription', dto.damageDescription);
    inList('sellerCategory', dto.sellerCategory);
    if (dto.yearMin) and.push(Prisma.sql`"year" >= ${dto.yearMin}`);
    if (dto.yearMax) and.push(Prisma.sql`"year" <= ${dto.yearMax}`);
    if (dto.odometerMin) and.push(Prisma.sql`"odometer" >= ${dto.odometerMin}`);
    if (dto.odometerMax) and.push(Prisma.sql`"odometer" <= ${dto.odometerMax}`);
    if (dto.saleDateFrom) and.push(Prisma.sql`"saleDate" >= ${dto.saleDateFrom}`);
    if (dto.saleDateTo) and.push(Prisma.sql`"saleDate" <= ${dto.saleDateTo}`);

    // Igual que StatsService: categoria → codigos crudos de saleTitleType.
    if (dto.titleCategory?.length) {
      const overrides = await this.titleMapping.getOverrides();
      const known = dto.titleCategory.filter((c) => c !== 'unknown');
      const or: Prisma.Sql[] = [];
      if (known.length) {
        const codes = codesForTitleCategories(known, overrides).map((c) => c.toUpperCase());
        if (codes.length) or.push(Prisma.sql`upper("saleTitleType") IN (${Prisma.join(codes)})`);
      }
      if (dto.titleCategory.includes('unknown')) {
        const all = allKnownCodes(overrides).map((c) => c.toUpperCase());
        or.push(all.length ? Prisma.sql`("saleTitleType" IS NULL OR upper("saleTitleType") NOT IN (${Prisma.join(all)}))` : Prisma.sql`TRUE`);
      }
      and.push(or.length ? Prisma.sql`(${Prisma.join(or, ' OR ')})` : Prisma.sql`FALSE`);
    }
    return Prisma.sql`WHERE ${Prisma.join(and, ' AND ')}`;
  }

  private async rows<T>(sql: Prisma.Sql): Promise<T[]> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '8s'");
      return tx.$queryRaw(sql);
    }) as Promise<T[]>;
  }

  /**
   * Mediana y banda p25–p75 por semana (o por dia si el rango es de un mes o
   * menos), con el volumen vendido en cada cubo.
   */
  trend(dto: AnalyticsQueryDto) {
    return this.cached('trend', dto, async () => {
      const desde = dto.saleDateFrom ?? 0;
      const hasta = dto.saleDateTo ?? houstonToday();
      const unidad = dto.interval ?? (desde && hasta - desde <= 100 ? 'day' : 'week');
      const fecha = Prisma.sql`to_date("saleDate"::text, 'YYYYMMDD')`;
      const cubo = unidad === 'month'
        ? Prisma.sql`date_trunc('month', ${fecha})`
        : unidad === 'day' ? Prisma.sql`date_trunc('day', ${fecha})` : Prisma.sql`date_trunc('week', ${fecha})`;
      const filas = await this.rows<{ t: Date; n: bigint; p25: number; p50: number; p75: number }>(Prisma.sql`
        SELECT ${cubo} AS t, count(*) AS n,
               percentile_cont(0.25) WITHIN GROUP (ORDER BY "finalBid")::float AS p25,
               percentile_cont(0.50) WITHIN GROUP (ORDER BY "finalBid")::float AS p50,
               percentile_cont(0.75) WITHIN GROUP (ORDER BY "finalBid")::float AS p75
          FROM ${this.table(dto)} ${await this.where(dto, [Prisma.sql`"saleDate" IS NOT NULL`])}
         GROUP BY 1 ORDER BY 1`);
      const points: TrendPoint[] = filas.map((f) => ({
        t: new Date(f.t).toISOString().slice(0, 10),
        n: Number(f.n),
        // Un cubo con 2 ventas no tiene banda que valga: solo el volumen.
        p25: Number(f.n) >= MUESTRA_MINIMA ? r(f.p25) : null,
        p50: Number(f.n) >= MUESTRA_MINIMA ? r(f.p50) : null,
        p75: Number(f.n) >= MUESTRA_MINIMA ? r(f.p75) : null,
      }));
      const muestra = points.reduce((s, p) => s + p.n, 0);
      return { interval: unidad, muestra, suficiente: muestra >= MUESTRA_MINIMA, points };
    });
  }

  /**
   * Histograma del precio final. El tope es el p97 —la cola de 60.000 $
   * aplastaria el resto— y lo que queda por encima va en el ultimo cubo.
   */
  distribution(dto: AnalyticsQueryDto) {
    return this.cached('distribution', dto, async () => {
      const where = await this.where(dto);
      const [s] = await this.rows<{ n: bigint; p50: number; p97: number; mean: number }>(Prisma.sql`
        SELECT count(*) AS n,
               percentile_cont(0.50) WITHIN GROUP (ORDER BY "finalBid")::float AS p50,
               percentile_cont(0.97) WITHIN GROUP (ORDER BY "finalBid")::float AS p97,
               avg("finalBid")::float AS mean
          FROM ${this.table(dto)} ${where}`);
      const muestra = Number(s?.n ?? 0);
      if (!muestra) return { muestra: 0, suficiente: false, median: null, mean: null, step: 0, bins: [] };
      const bins = Math.min(Math.max(dto.bins ?? 30, 5), 60);
      const step = niceStep(Math.max(s.p97, 1), bins);
      const top = Math.ceil(Math.max(s.p97, step) / step);
      const filas = await this.rows<{ b: number; n: bigint }>(Prisma.sql`
        SELECT LEAST(floor("finalBid" / ${step})::int, ${top}) AS b, count(*) AS n
          FROM ${this.table(dto)} ${where}
         GROUP BY 1 ORDER BY 1`);
      const porCubo = new Map(filas.map((f) => [Number(f.b), Number(f.n)]));
      return {
        muestra,
        suficiente: muestra >= MUESTRA_MINIMA,
        median: r(s.p50),
        mean: r(s.mean),
        step,
        bins: Array.from({ length: top + 1 }, (_, b) => ({
          from: b * step,
          // El ultimo cubo es "≥ from": junta la cola larga.
          to: b === top ? null : (b + 1) * step,
          n: porCubo.get(b) ?? 0,
        })),
      };
    });
  }

  /**
   * Tarjetas de arriba: ultimos `days` dias frente a los `days` anteriores,
   * con la mediana semanal de las ultimas 12 semanas como sparkline.
   */
  kpis(dto: AnalyticsQueryDto) {
    return this.cached('kpis', dto, async () => {
      const days = Math.min(Math.max(dto.days ?? 30, 7), 365);
      const hoy = dto.saleDateTo ?? houstonToday();
      const ini = shiftYmd(hoy, -days + 1);
      const iniPrev = shiftYmd(ini, -days);
      // El periodo lo marca la tarjeta: los filtros de fecha no se suman.
      const base: AnalyticsQueryDto = { ...dto, saleDateFrom: undefined, saleDateTo: undefined };
      const periodo = async (desde: number, hasta: number) => {
        const [f] = await this.rows<{ n: bigint; p50: number; erv: number }>(Prisma.sql`
          SELECT count(*) AS n,
                 percentile_cont(0.50) WITHIN GROUP (ORDER BY "finalBid")::float AS p50,
                 percentile_cont(0.50) WITHIN GROUP (ORDER BY "finalBid" / NULLIF("estRetailValue", 0))
                   FILTER (WHERE "estRetailValue" > 0)::float AS erv
            FROM ${this.table(dto)}
            ${await this.where(base, [Prisma.sql`"saleDate" BETWEEN ${desde} AND ${hasta}`])}`);
        const muestra = Number(f?.n ?? 0);
        return {
          muestra,
          median: muestra >= MUESTRA_MINIMA ? r(f.p50) : null,
          // Mediana de "precio final / valor estimado", en %.
          pctOfRetail: muestra >= MUESTRA_MINIMA && f.erv !== null ? Math.round(Number(f.erv) * 1000) / 10 : null,
        };
      };
      const [actual, anterior, spark] = await Promise.all([
        periodo(ini, hoy),
        periodo(iniPrev, shiftYmd(ini, -1)),
        this.trend({ ...base, saleDateFrom: shiftYmd(hoy, -83), saleDateTo: hoy, interval: 'week' }),
      ]);
      const cambio = (a: number | null, b: number | null) => (a !== null && b ? Math.round(((a - b) / b) * 1000) / 10 : null);
      return {
        days,
        from: ini,
        to: hoy,
        current: actual,
        previous: anterior,
        change: {
          median: cambio(actual.median, anterior.median),
          volume: cambio(actual.muestra, anterior.muestra || null),
          pctOfRetail: actual.pctOfRetail !== null && anterior.pctOfRetail !== null
            ? Math.round((actual.pctOfRetail - anterior.pctOfRetail) * 10) / 10
            : null,
        },
        spark: spark.points.map((p) => ({ t: p.t, n: p.n, p50: p.p50 })),
        suficiente: actual.muestra >= MUESTRA_MINIMA,
      };
    });
  }

  /** Mediana y banda p25-p75 por tipo de daño, de mas a menos vendido. */
  damage(dto: AnalyticsQueryDto) {
    return this.cached('damage', dto, async () => {
      const limit = dto.limit ?? 10;
      const where = await this.where(dto, [Prisma.sql`"damageDescription" IS NOT NULL`]);
      const [tot] = await this.rows<{ n: bigint }>(Prisma.sql`SELECT count(*) AS n FROM ${this.table(dto)} ${where}`);
      const muestra = Number(tot?.n ?? 0);
      const filas = await this.rows<{ damage: string; n: bigint; p25: number; p50: number; p75: number }>(Prisma.sql`
        SELECT "damageDescription" AS damage, count(*) AS n,
               percentile_cont(0.25) WITHIN GROUP (ORDER BY "finalBid")::float AS p25,
               percentile_cont(0.50) WITHIN GROUP (ORDER BY "finalBid")::float AS p50,
               percentile_cont(0.75) WITHIN GROUP (ORDER BY "finalBid")::float AS p75
          FROM ${this.table(dto)} ${where}
         GROUP BY 1 HAVING count(*) >= ${MUESTRA_MINIMA} ORDER BY count(*) DESC LIMIT ${limit}`);
      const groups = filas.map((f) => ({ damage: f.damage, n: Number(f.n), p25: r(f.p25), p50: r(f.p50), p75: r(f.p75) }));
      const otros = muestra - groups.reduce((s, g) => s + g.n, 0);
      return { muestra, suficiente: groups.length > 0, otros, groups };
    });
  }

  /** Mediana y banda p25-p75 por cubo de kilometraje, con tope en 250k. */
  odometer(dto: AnalyticsQueryDto) {
    return this.cached('odometer', dto, async () => {
      const step = dto.step ?? 25000;
      const cap = 250000;
      const top = cap / step;
      const where = await this.where(dto, [Prisma.sql`"odometer" IS NOT NULL AND "odometer" BETWEEN 0 AND 500000`]);
      const filas = await this.rows<{ b: number; n: bigint; p25: number; p50: number; p75: number }>(Prisma.sql`
        SELECT LEAST(floor("odometer" / ${step})::int, ${top}) AS b, count(*) AS n,
               percentile_cont(0.25) WITHIN GROUP (ORDER BY "finalBid")::float AS p25,
               percentile_cont(0.50) WITHIN GROUP (ORDER BY "finalBid")::float AS p50,
               percentile_cont(0.75) WITHIN GROUP (ORDER BY "finalBid")::float AS p75
          FROM ${this.table(dto)} ${where}
         GROUP BY 1`);
      const porCubo = new Map(filas.map((f) => [Number(f.b), f]));
      const buckets = Array.from({ length: top + 1 }, (_, b) => {
        const f = porCubo.get(b);
        const n = f ? Number(f.n) : 0;
        return {
          from: b * step,
          to: b === top ? null : (b + 1) * step,
          n,
          p25: n >= MUESTRA_MINIMA ? r(f!.p25) : null,
          p50: n >= MUESTRA_MINIMA ? r(f!.p50) : null,
          p75: n >= MUESTRA_MINIMA ? r(f!.p75) : null,
        };
      });
      const muestra = buckets.reduce((s, b) => s + b.n, 0);
      return { muestra, suficiente: muestra >= MUESTRA_MINIMA, step, buckets };
    });
  }

  /** Compara 2-4 vehiculos (make:model) bajo los mismos filtros. */
  compare(dto: AnalyticsQueryDto) {
    return this.cached('compare', dto, async () => {
      const entradas = dto.vehicles ?? [];
      if (entradas.length < 2 || entradas.length > 4) {
        throw new BadRequestException({ code: 'compare_vehicles' });
      }
      const series: {
        input: string; make: string | null; model: string | null; found: boolean;
        n: number; suficiente: boolean; p25: number | null; p50: number | null; p75: number | null;
        odometerMedian: number | null;
      }[] = [];
      for (const input of entradas) {
        const i = input.indexOf(':');
        const makeTexto = i === -1 ? input : input.slice(0, i);
        const modelTexto = i === -1 ? '' : input.slice(i + 1);
        const [makeRes] = await this.vocab.resolve('make', makeTexto, 1);
        const [modelRes] = await this.vocab.resolve('model', modelTexto, 1);
        if (!makeRes || !modelRes) {
          series.push({ input, make: null, model: null, found: false, n: 0, suficiente: false, p25: null, p50: null, p75: null, odometerMedian: null });
          continue;
        }
        const make = makeRes.valor, model = modelRes.valor;
        const dtoVehiculo: AnalyticsQueryDto = { ...dto, make: [make], model: [model] };
        const where = await this.where(dtoVehiculo);
        const [fila] = await this.rows<{ n: bigint; p25: number; p50: number; p75: number; odo: number }>(Prisma.sql`
          SELECT count(*) AS n,
                 percentile_cont(0.25) WITHIN GROUP (ORDER BY "finalBid")::float AS p25,
                 percentile_cont(0.50) WITHIN GROUP (ORDER BY "finalBid")::float AS p50,
                 percentile_cont(0.75) WITHIN GROUP (ORDER BY "finalBid")::float AS p75,
                 percentile_cont(0.50) WITHIN GROUP (ORDER BY "odometer")::float AS odo
            FROM ${this.table(dtoVehiculo)} ${where}`);
        const n = Number(fila?.n ?? 0);
        const suficiente = n >= MUESTRA_MINIMA;
        series.push({
          input, make, model, found: true, n, suficiente,
          p25: suficiente ? r(fila.p25) : null,
          p50: suficiente ? r(fila.p50) : null,
          p75: suficiente ? r(fila.p75) : null,
          odometerMedian: suficiente ? r(fila.odo) : null,
        });
      }
      return { series };
    });
  }

  /** Para tests: vacia la cache. */
  clearCache() {
    this.cache.clear();
  }
}
