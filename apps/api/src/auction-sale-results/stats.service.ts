import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import {
  codesForTitleCategories,
  deriveTitleCategory,
  allKnownCodes,
  TITLE_CATEGORIES,
} from '@htownautos/common';
import type { TitleCategory } from '@htownautos/common';
import { TitleMappingService } from '../title-mapping/title-mapping.service';
import { QueryStatsDto } from './dto/query-stats.dto';

type Where = Prisma.AuctionSaleResultWhereInput;
const num = (d: Prisma.Decimal | null | undefined): number | null =>
  d === null || d === undefined ? null : Number(d);

const redondea = (v: number | null | undefined): number | null =>
  v === null || v === undefined ? null : Math.round(v);

/**
 * Dimensiones por las que se puede desglosar o resolver valores.
 *
 * Es una lista cerrada a proposito: el nombre de columna se interpola en SQL
 * —`GROUP BY` no admite parametro—, asi que solo pueden entrar valores de aqui.
 * Si algun dia se acepta el campo desde fuera sin pasar por este mapa, es
 * inyeccion.
 */
const BREAKDOWN_COLUMNS = {
  year: 'year',
  make: 'make',
  model: 'model',
  trim: 'trim',
  damage: 'damageDescription',
  title: 'saleTitleType',
  state: 'locationState',
  color: 'color',
  bodyStyle: 'bodyStyle',
} as const;

export type BreakdownField = keyof typeof BREAKDOWN_COLUMNS;
export const BREAKDOWN_FIELDS = Object.keys(BREAKDOWN_COLUMNS) as BreakdownField[];

/**
 * Read/search + facets over auction_sale_results for the "Stats Listing" page.
 * Mirrors the auction search filters (same promoted vehicle columns) and adds
 * the Final Bid range. Prisma-backed (Postgres), reusing the same title-category
 * derivation utils as the copart/opensearch services.
 */
@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly titleMapping: TitleMappingService,
  ) {}

  async search(dto: QueryStatsDto) {
    const page = dto.page && dto.page > 0 ? dto.page : 1;
    const limit = Math.min(dto.limit ?? 25, 100);
    const where = await this.buildWhere(dto);

    const orderBy = this.buildOrderBy(dto);

    const [rows, total] = await Promise.all([
      this.prisma.auctionSaleResult.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auctionSaleResult.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;
    const result: any = {
      data: rows.map((r) => this.serialize(r)),
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
    if (dto.includeAggregations) {
      result.aggregations = await this.getFilters(dto);
    }
    return result;
  }

  /** Facet counts in the same shape the auction sidebar consumes. */
  /**
   * Un resultado de venta por numero de lote, para la vista individual.
   *
   * Se busca por `lot` y no por `id` porque es lo que aparece en la URL y en la
   * tarjeta. Si hubiera mas de una fila para el mismo lote —el mismo coche
   * subastado dos veces— se devuelve la venta mas reciente.
   */
  async findByLot(lot: string) {
    let value: bigint;
    try {
      value = BigInt(lot);
    } catch {
      throw new NotFoundException(`Lot ${lot} is not a number`);
    }
    const row = await this.prisma.auctionSaleResult.findFirst({
      where: { lot: value },
      orderBy: [{ saleDate: 'desc' }, { createdAt: 'desc' }],
    });
    if (!row) throw new NotFoundException(`No sale result for lot ${lot}`);
    return this.serialize(row);
  }

  // ── Agregados para el chat de IA ────────────────────────────────────────────

  /**
   * Por debajo de esto una media no significa nada. El chat lo usa para avisar
   * en vez de dar una cifra que suena precisa y no lo es.
   */
  static readonly MUESTRA_MINIMA = 10;

  /**
   * Distribucion del precio final para un conjunto de filtros.
   *
   * Devuelve **mediana y percentiles antes que la media**: un lote adjudicado en
   * 45.000 entre coches de 4.000 mueve la media y deja la mediana quieta, y es
   * la mediana la que responde a "cuanto se paga por esto".
   *
   * `percentile_cont` no esta en Prisma, asi que va en consulta cruda — pero
   * partiendo del mismo `buildWhere` que la pantalla de Stats, para que el chat
   * y la rejilla no puedan discrepar sobre lo que significa un filtro.
   */
  async priceStats(dto: QueryStatsDto) {
    const where = await this.buildWhere(dto);

    // Se resuelven los ids con Prisma y se agrega sobre ellos: asi el filtro
    // sigue siendo el mismo codigo, sin duplicar su logica en SQL.
    const ids = await this.prisma.auctionSaleResult.findMany({
      where: { ...where, finalBid: { not: null } },
      select: { id: true },
      take: 50_000, // techo de seguridad; con mas, la mediana ya no cambia
    });

    if (ids.length === 0) {
      return { muestra: 0, suficiente: false, precio: null, odometroMediana: null };
    }

    // El getter de PrismaService devuelve la funcion ya enlazada y pierde la
    // firma generica, asi que el tipo se pone con un cast en el resultado.
    const filas = (await this.prisma.$queryRaw`
      SELECT count(*)                                                        AS n,
             percentile_cont(0.25) WITHIN GROUP (ORDER BY "finalBid")::float AS p25,
             percentile_cont(0.50) WITHIN GROUP (ORDER BY "finalBid")::float AS mediana,
             percentile_cont(0.75) WITHIN GROUP (ORDER BY "finalBid")::float AS p75,
             min("finalBid")::float                                          AS minimo,
             max("finalBid")::float                                          AS maximo,
             avg("finalBid")::float                                          AS media,
             percentile_cont(0.50) WITHIN GROUP (ORDER BY odometer)::float   AS odo
        FROM auction_sale_results
       WHERE id = ANY(${ids.map((r) => r.id)}::text[])
    `) as {
      n: bigint;
      p25: number | null;
      mediana: number | null;
      p75: number | null;
      minimo: number | null;
      maximo: number | null;
      media: number | null;
      odo: number | null;
    }[];

    const r = filas[0];
    const muestra = Number(r?.n ?? 0);
    return {
      muestra,
      suficiente: muestra >= StatsService.MUESTRA_MINIMA,
      precio: {
        mediana: redondea(r?.mediana),
        p25: redondea(r?.p25),
        p75: redondea(r?.p75),
        minimo: redondea(r?.minimo),
        maximo: redondea(r?.maximo),
        media: redondea(r?.media),
      },
      odometroMediana: redondea(r?.odo),
    };
  }

  /**
   * Reparto por una dimension, con recuento y mediana de precio en cada grupo.
   * Es lo que contesta "¿que año sale mas a cuenta?" sin que el modelo tenga
   * que pedir una consulta por año.
   */
  async breakdown(dto: QueryStatsDto, por: BreakdownField, limite = 15) {
    const columna = BREAKDOWN_COLUMNS[por];
    const where = await this.buildWhere(dto);

    const ids = await this.prisma.auctionSaleResult.findMany({
      where: { ...where, finalBid: { not: null } },
      select: { id: true },
      take: 50_000,
    });
    if (ids.length === 0) return [];

    // El getter de PrismaService devuelve la funcion ya enlazada y pierde la
    // firma generica, asi que el tipo se pone con un cast en el resultado.
    const filas = (await this.prisma.$queryRawUnsafe(
      `SELECT "${columna}"::text AS grupo,
              count(*) AS n,
              percentile_cont(0.50) WITHIN GROUP (ORDER BY "finalBid")::float AS mediana
         FROM auction_sale_results
        WHERE id = ANY($1::text[]) AND "${columna}" IS NOT NULL
        GROUP BY "${columna}"
        ORDER BY count(*) DESC
        LIMIT $2`,
      ids.map((r) => r.id),
      limite,
    )) as { grupo: string | null; n: bigint; mediana: number | null }[];

    return filas.map((f) => ({
      grupo: f.grupo,
      muestra: Number(f.n),
      suficiente: Number(f.n) >= StatsService.MUESTRA_MINIMA,
      medianaPrecio: redondea(f.mediana),
    }));
  }

  /**
   * Valores reales que existen en los datos para un campo, buscando por texto.
   *
   * Sin esto el modelo filtra por el nombre que el usuario escribio —"Tacoma"—
   * donde los datos guardan otra cosa, recibe cero filas y responde "no hay
   * datos" con total seguridad. Devuelve tambien cuantas ventas tiene cada
   * valor, que es como el modelo elige entre varios parecidos.
   */
  async resolveValues(campo: BreakdownField, texto: string, limite = 10) {
    const columna = BREAKDOWN_COLUMNS[campo];

    // Se compara ignorando guiones y espacios en AMBOS lados. No es cosmetico:
    // los datos traen "F-150" (87 ventas) y "F150" (1539) como valores
    // distintos, asi que buscar literalmente "f-150" devolveria el 5% de los
    // datos y el modelo respondera con total seguridad una cifra falsa.
    const aguja = texto.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (!aguja) return [];

    const filas = (await this.prisma.$queryRawUnsafe(
      `SELECT "${columna}"::text AS valor, count(*) AS n
         FROM auction_sale_results
        WHERE "${columna}" IS NOT NULL
          AND regexp_replace("${columna}"::text, '[^A-Za-z0-9]', '', 'g') ILIKE $1
        GROUP BY "${columna}"
        ORDER BY count(*) DESC
        LIMIT $2`,
      `%${aguja}%`,
      limite,
    )) as { valor: string | null; n: bigint }[];
    return filas.map((f) => ({ valor: f.valor, ventas: Number(f.n) }));
  }

  /** Rango real de fechas cubierto. El chat lo necesita para no inventar tendencias. */
  async coverage() {
    const r = await this.prisma.auctionSaleResult.aggregate({
      _min: { emittedAt: true },
      _max: { emittedAt: true },
      _count: { _all: true },
    });
    return {
      desde: r._min.emittedAt,
      hasta: r._max.emittedAt,
      totalVentas: r._count._all,
    };
  }

  async getFilters(dto: QueryStatsDto) {
    const titleOverrides = await this.titleMapping.getOverrides();
    // Un `where` por faceta, cada uno sin su propio filtro. Se construyen en
    // paralelo porque buildWhere puede pedir los overrides de titulo.
    const scoped = async (field: string) => this.facet(field, await this.buildWhere(dto, field));

    const [
      makes, models, trims, years, states, bodyTypes, transmissions, fuelTypes,
      damageTypes, titleTypes, colors, cylinders, drivetrains, sellerCategories,
      yards, sellers, runsDrivesOptions, soldBuckets,
    ] = await Promise.all([
      scoped('make'),
      scoped('model'),
      scoped('trim'),
      scoped('year'),
      scoped('locationState'),
      scoped('bodyStyle'),
      scoped('transmission'),
      scoped('fuelType'),
      scoped('damageDescription'),
      scoped('saleTitleType'),
      scoped('color'),
      scoped('cylinders'),
      scoped('drive'),
      scoped('sellerCategory'),
      scoped('yardName'),
      scoped('sellerName'),
      scoped('runsDrives'),
      scoped('sold'),
    ]);

    // Derive title categories from raw saleTitleType buckets (same util as search)
    const categoryCounts: Record<TitleCategory, number> = {
      clean: 0,
      salvage: 0,
      nonrepairable: 0,
      unknown: 0,
    } as Record<TitleCategory, number>;
    for (const b of titleTypes) {
      categoryCounts[deriveTitleCategory(String(b.key), titleOverrides)] += b.count;
    }
    const titleCategories = (Object.keys(categoryCounts) as TitleCategory[])
      .map((k) => ({ key: k, count: categoryCounts[k] }))
      .filter((c) => c.count > 0);

    const saleStatuses = soldBuckets.map((b) => ({
      key: String(b.key) === 'true' ? 'Sold' : 'Not Sold',
      count: b.count,
    }));

    return {
      sources: [],
      makes, models, trims, years, states, bodyTypes, transmissions, fuelTypes,
      damageTypes, saleStatuses, titleTypes, titleCategories, colors, cylinders,
      drivetrains, sellerCategories, yards, sellers,
      lotCondCodes: [],
      runsDrivesOptions,
      saleLights: [],
    };
  }

  // ── helpers ──

  /**
   * `omit` deja fuera el filtro de esa faceta.
   *
   * Es lo que permite multiseleccion: si el desplegable de marca se calcula con
   * la marca ya filtrada, al elegir FORD desaparecen las demas y no hay forma de
   * anadir una segunda. Cada faceta se cuenta ignorando su propia seleccion pero
   * respetando las de las demas — y de ahi sale la cascada, porque modelo si
   * respeta la marca.
   */
  private async buildWhere(dto: QueryStatsDto, omit?: string): Promise<Where> {
    const and: Where[] = [];

    if (dto.search) {
      const s = dto.search.trim();
      const or: Where[] = [
        { vin: { contains: s, mode: 'insensitive' } },
        { make: { contains: s, mode: 'insensitive' } },
        { model: { contains: s, mode: 'insensitive' } },
        { modelDetail: { contains: s, mode: 'insensitive' } },
      ];
      if (/^\d+$/.test(s)) {
        try { or.push({ lot: BigInt(s) }); } catch { /* ignore */ }
      }
      and.push({ OR: or });
    }

    const inArr = (field: keyof Where, vals?: string[]) => {
      if (field === omit) return;
      if (vals && vals.length) and.push({ [field]: { in: vals } } as Where);
    };
    inArr('make', dto.make);
    inArr('model', dto.model);
    inArr('trim', dto.trim);
    inArr('bodyStyle', dto.bodyType);
    inArr('color', dto.color);
    inArr('cylinders', dto.cylinders);
    inArr('drive', dto.drivetrain);
    inArr('damageDescription', dto.damageDescription);
    inArr('saleTitleType', dto.saleTitleType);
    inArr('locationState', dto.locationState);
    inArr('yardName', dto.yardName);
    inArr('sellerName', dto.sellerName);
    inArr('sellerCategory', dto.sellerCategory);

    if (dto.transmission && omit !== 'transmission') {
      and.push({ transmission: { equals: dto.transmission, mode: 'insensitive' } });
    }
    if (dto.fuelType && omit !== 'fuelType') {
      and.push({ fuelType: { equals: dto.fuelType, mode: 'insensitive' } });
    }
    if (dto.runsDrives && omit !== 'runsDrives') {
      and.push({ runsDrives: { equals: dto.runsDrives, mode: 'insensitive' } });
    }

    // Status: reuse the sidebar Status block → sold boolean.
    if (dto.saleStatus && omit !== 'sold') {
      const v = dto.saleStatus.toLowerCase();
      if (v.startsWith('sold') && !v.includes('not')) and.push({ sold: true });
      else if (v.includes('not')) and.push({ sold: false });
    }
    if (dto.sold !== undefined && omit !== 'sold') and.push({ sold: dto.sold });

    if ((dto.yearMin || dto.yearMax) && omit !== 'year') {
      and.push({ year: { ...(dto.yearMin ? { gte: dto.yearMin } : {}), ...(dto.yearMax ? { lte: dto.yearMax } : {}) } });
    }
    if (dto.odometerMin || dto.odometerMax) {
      and.push({ odometer: { ...(dto.odometerMin ? { gte: dto.odometerMin } : {}), ...(dto.odometerMax ? { lte: dto.odometerMax } : {}) } });
    }
    if (dto.finalBidMin || dto.finalBidMax) {
      and.push({ finalBid: { ...(dto.finalBidMin ? { gte: dto.finalBidMin } : {}), ...(dto.finalBidMax ? { lte: dto.finalBidMax } : {}) } });
    }
    if (dto.saleDateFrom || dto.saleDateTo) {
      and.push({ saleDate: { ...(dto.saleDateFrom ? { gte: dto.saleDateFrom } : {}), ...(dto.saleDateTo ? { lte: dto.saleDateTo } : {}) } });
    }

    // titleCategory → raw saleTitleType codes (base + learned overrides).
    // El bloque "Vehicle Title Type" filtra por titleCategory pero sus cuentas
    // salen de los buckets de saleTitleType, asi que omitir uno tiene que omitir
    // el otro o la categoria elegida se comeria a las demas.
    if (dto.titleCategory && dto.titleCategory.length && omit !== 'saleTitleType') {
      const titleOverrides = await this.titleMapping.getOverrides();
      const cats = dto.titleCategory;
      const known = cats.filter((c) => c !== 'unknown');
      const wantUnknown = cats.includes('unknown');
      const or: Where[] = [];
      if (known.length) {
        const codes = codesForTitleCategories(known, titleOverrides);
        if (codes.length) or.push({ saleTitleType: { in: codes, mode: 'insensitive' } });
      }
      if (wantUnknown) {
        or.push({ NOT: { saleTitleType: { in: allKnownCodes(titleOverrides), mode: 'insensitive' } } });
      }
      if (or.length === 1) and.push(or[0]);
      else if (or.length > 1) and.push({ OR: or });
    }

    return and.length ? { AND: and } : {};
  }

  private buildOrderBy(dto: QueryStatsDto): Prisma.AuctionSaleResultOrderByWithRelationInput[] {
    const order = dto.sortOrder === 'asc' ? 'asc' : 'desc';
    const col = dto.sortBy ?? 'saleDate';
    const nullableNumeric = new Set(['finalBid', 'askingPrice', 'odometer']);
    const primary: any = nullableNumeric.has(col)
      ? { [col]: { sort: order, nulls: 'last' } }
      : { [col]: order };
    return [primary, { createdAt: 'desc' }];
  }

  /** groupBy one column → [{key,count}] desc, nulls dropped. */
  private async facet(
    field: string,
    where: Where,
  ): Promise<Array<{ key: string | number; count: number }>> {
    const rows: any[] = await (this.prisma.auctionSaleResult.groupBy as any)({
      by: [field],
      where,
      _count: { _all: true },
    });
    return rows
      .filter((r) => r[field] !== null && r[field] !== undefined && r[field] !== '')
      .map((r) => ({ key: r[field], count: r._count._all }))
      .sort((a, b) => b.count - a.count);
  }

  private serialize(r: any) {
    return {
      id: r.id,
      lot: r.lot.toString(),
      sourceId: r.lot.toString(),
      saleDate: r.saleDate,
      auctionSession: r.auctionSession,
      saleLocationSlug: r.saleLocationSlug,
      finalBid: num(r.finalBid),
      askingPrice: num(r.askingPrice),
      reserve: r.reserve,
      sold: r.sold,
      ticks: r.ticks,
      round: r.round,
      saleOrder: r.saleOrder,
      event: r.event,
      pageUrl: r.pageUrl,
      receivedAt: r.receivedAt,
      // Lo que solo trae el frame de la subasta en vivo. El serializador es una
      // lista explicita, asi que una columna nueva no aparece sola: se guardaba
      // bien y se leia como null.
      saleRoom: r.saleRoom,
      reserveMet: r.reserveMet,
      approved: r.approved,
      buyerNo: r.buyerNo,
      buyerState: r.buyerState,
      buyerCountry: r.buyerCountry,
      itemNo: r.itemNo,
      emittedAt: r.emittedAt,
      pendingApproval: r.pendingApproval,
      matched: r.matched,
      vin: r.vin,
      year: r.year,
      make: r.make,
      model: r.model,
      modelDetail: r.modelDetail,
      trim: r.trim,
      bodyType: r.bodyStyle,
      color: r.color,
      damageDescription: r.damageDescription,
      secondaryDamage: r.secondaryDamage,
      saleTitleType: r.saleTitleType,
      saleTitleState: r.saleTitleState,
      odometer: num(r.odometer),
      runsDrives: r.runsDrives,
      transmission: r.transmission,
      drivetrain: r.drive,
      fuelType: r.fuelType,
      cylinders: r.cylinders,
      estRetailValue: num(r.estRetailValue),
      repairCost: num(r.repairCost),
      highBidAtSync: num(r.highBidAtSync),
      yardNumber: r.yardNumber,
      yardName: r.yardName,
      locationCity: r.locationCity,
      locationState: r.locationState,
      locationZip: r.locationZip,
      sellerName: r.sellerName,
      sellerCategory: r.sellerCategory,
      createdAt: r.createdAt,
    };
  }
}
