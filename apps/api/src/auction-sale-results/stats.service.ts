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
