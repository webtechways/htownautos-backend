import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { deriveTitleCategory, iaaiGalleryImages, iaaiSaleParts } from '@htownautos/common';
import { TitleMappingService } from '../title-mapping/title-mapping.service';
import { IAAI_INDEX_NAME, IaaiIndexService } from '@htownautos/opensearch';
import { AuctionSearchService } from '../opensearch/auction-search.service';
import { SearchAuctionsDto } from '../opensearch/dto/search-auctions.dto';

type Row = Prisma.IaaiListingGetPayload<{}>;
type Agg = { key: string | number; count: number };

const TZ = 'America/Chicago';
const FACET_TTL_MS = 2 * 60_000;
const FACET_LIMIT = 500;

/** YYYYMMDD (a day in Central time) → the UTC instant that day starts. */
function centralDayStart(yyyymmdd: number): Date {
  const s = String(yyyymmdd);
  const guess = new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)), 6));
  // Central is UTC-5/-6: walk back to the first instant whose Central date matches.
  const date = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
  const target = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  let t = guess.getTime();
  while (date(new Date(t - 3600_000)) === target) t -= 3600_000;
  while (date(new Date(t)) !== target) t += 3600_000;
  return new Date(t);
}

const runsDrivesOf = (r: { runAndDrive: boolean | null; startCode: string | null }) =>
  r.runAndDrive ? 'Run & Drive' : r.startCode;

/**
 * IAAI lots (scraped from bidexport) shaped exactly like the Copart search
 * results, so /dashboard/auction-iaai can render them with the same page.
 * Same query parameters as /auctions/search; the ones with no IAAI equivalent
 * (seller category, sale light, Carfax…) are ignored.
 */
@Injectable()
export class IaaiListingsService {
  private facetCache = new Map<string, { at: number; value: Record<string, Agg[]> }>();

  private titleDocsCache: { at: number; docs: (string | null)[] } | null = null;

  private indexCount: { at: number; n: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly titleMapping: TitleMappingService,
    private readonly auctionSearch: AuctionSearchService,
    private readonly iaaiIndex: IaaiIndexService,
  ) {}

  /**
   * Search and facets run on OpenSearch (index iaai_listings) with the Copart
   * engine — same query, facets and sort as /auctions/search — once the index
   * holds documents. Until the first index (or if OpenSearch fails) they fall
   * back to Postgres, so the page never goes blank.
   */
  private async useIndex(): Promise<boolean> {
    if (!this.indexCount || Date.now() - this.indexCount.at > 60_000) {
      this.indexCount = { at: Date.now(), n: await this.iaaiIndex.count() };
    }
    return this.indexCount.n > 0;
  }

  /**
   * The title-category filter for the index: IAAI stores title documents
   * (CLEAR, SALVAGE…), not Copart codes, so the categories are resolved here
   * with the same classifier the card label and the facet counts use.
   */
  /** Title categories for the index: the shared IAAI clause of the search engine. */
  private async indexTitleClause(q: SearchAuctionsDto): Promise<any> {
    const cats = (Array.isArray(q.titleCategory) ? q.titleCategory : []) as string[];
    if (!cats.length) return undefined;
    return this.auctionSearch.iaaiTitleClause(cats, await this.titleMapping.getOverrides());
  }

  async search(q: SearchAuctionsDto) {
    if (await this.useIndex()) {
      try {
        return await this.auctionSearch.search(q, IAAI_INDEX_NAME, await this.indexTitleClause(q));
      } catch {
        // fall through to Postgres
      }
    }
    return this.searchDb(q);
  }

  async filters(q: SearchAuctionsDto) {
    if (await this.useIndex()) {
      try {
        return await this.auctionSearch.getFilterOptions(q, IAAI_INDEX_NAME, await this.indexTitleClause(q));
      } catch {
        // fall through to Postgres
      }
    }
    const list = (v: unknown) => (Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(',') : undefined) as string[] | undefined;
    return this.facets(list(q.make), list(q.model));
  }

  /**
   * IAAI's title documents (CLEAR, SALVAGE, NON-REPAIRABLE, BILL OF SALE…),
   * a handful of distinct values. Cached: they barely change.
   */
  private async titleDocs(): Promise<(string | null)[]> {
    if (this.titleDocsCache && Date.now() - this.titleDocsCache.at < FACET_TTL_MS) return this.titleDocsCache.docs;
    const rows = await this.prisma.iaaiListing.groupBy({ by: ['saleDocument'] });
    const docs = rows.map((r) => r.saleDocument);
    this.titleDocsCache = { at: Date.now(), docs };
    return docs;
  }

  /**
   * Title category filter (Clean / Rebuilt / Salvage / Non-repairable /
   * Unknown), classified exactly like Copart and like the card label: the
   * shared deriveTitleCategory plus the staff-learned mappings.
   */
  private async titleCategoryWhere(cats: string[]): Promise<Prisma.IaaiListingWhereInput | null> {
    if (!cats.length) return null;
    const overrides = await this.titleMapping.getOverrides();
    const docs = (await this.titleDocs()).filter((d) => cats.includes(deriveTitleCategory(d, overrides)));
    const named = docs.filter((d): d is string => !!d);
    const or: Prisma.IaaiListingWhereInput[] = [];
    if (named.length) or.push({ saleDocument: { in: named } });
    if (docs.includes(null)) or.push({ saleDocument: null });
    return or.length ? { OR: or } : { stockNumber: { in: [] } };
  }

  async searchDb(q: SearchAuctionsDto) {
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 25));
    const where = await this.where(q);
    const dir: Prisma.SortOrder = q.sortOrder === 'asc' ? 'asc' : 'desc';
    const nl = { sort: dir, nulls: 'last' as const };
    const orderBy: Prisma.IaaiListingOrderByWithRelationInput[] =
      q.sortBy === 'saleDate' ? [{ auctionAt: nl }]
      : q.sortBy === 'year' ? [{ year: nl }]
      : q.sortBy === 'odometer' ? [{ odometer: nl }]
      : q.sortBy === 'highBid' ? [{ currentBid: nl }]
      : [{ firstSeenAt: dir }];
    orderBy.push({ stockNumber: 'asc' });

    const [total, rows] = await Promise.all([
      this.prisma.iaaiListing.count({ where }),
      this.prisma.iaaiListing.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit, omit: { raw: true } }),
    ]);
    const totalPages = Math.ceil(total / limit);
    return {
      data: rows.map((r) => this.toListing(r as Row)),
      meta: { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 },
      ...(q.includeAggregations && { aggregations: await this.facets(q.make, q.model) }),
    };
  }

  async getOne(stockOrId: string) {
    const stock = stockOrId.replace(/^iaai-/, '');
    const row = await this.prisma.iaaiListing.findUnique({ where: { stockNumber: stock }, omit: { raw: true } });
    if (!row) throw new NotFoundException(`IAAI lot ${stock} not found`);
    return this.toListing(row as Row);
  }

  /** Gallery in the image cache's shape; IAAI's own URLs until the photos are copied. */
  async gallery(stockOrId: string) {
    const stock = stockOrId.replace(/^iaai-/, '');
    const row = await this.prisma.iaaiListing.findUnique({ where: { stockNumber: stock }, select: { images: true, imageSourceUrls: true } });
    if (!row) throw new NotFoundException(`IAAI lot ${stock} not found`);
    const cached = row.images as { images?: { sequence: number; thumbnail: string; fullSize: string }[] } | null;
    const images = cached?.images?.length ? cached.images : iaaiGalleryImages(row.imageSourceUrls);
    return { lotNumber: stock, imageCount: images.length, images, cached: !!cached?.images?.length };
  }

  /** Facets with counts over the active lots, cascading by make/model like Copart. */
  async facets(make?: string[], model?: string[]): Promise<Record<string, Agg[]>> {
    const key = JSON.stringify([make ?? [], model ?? []]);
    const hit = this.facetCache.get(key);
    if (hit && Date.now() - hit.at < FACET_TTL_MS) return hit.value;

    const base: Prisma.IaaiListingWhereInput = { isActive: true };
    const withMake: Prisma.IaaiListingWhereInput = { ...base, ...(make?.length && { make: { in: make } }) };
    const withModel: Prisma.IaaiListingWhereInput = { ...withMake, ...(model?.length && { model: { in: model } }) };

    const group = async (field: keyof Row, where: Prisma.IaaiListingWhereInput): Promise<Agg[]> => {
      const rows = (await this.prisma.iaaiListing.groupBy({
        by: [field] as any,
        where: { ...where, [field]: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { stockNumber: 'desc' } },
        take: FACET_LIMIT,
      } as any)) as unknown as Array<Record<string, any>>;
      return rows.map((r) => ({ key: r[field as string], count: r._count._all }));
    };

    const [total, makes, models, trims, years, states, bodyTypes, transmissions, fuelTypes, damageTypes, saleStatuses, titleTypes, colors, cylinders, drivetrains, yards, sellers, lotCondCodes, rd, titleRows, overrides] =
      await Promise.all([
        this.prisma.iaaiListing.count({ where: base }),
        group('make', base),
        group('model', withMake),
        group('series', withModel),
        group('year', withModel),
        group('locationState', withModel),
        group('bodyStyle', withModel),
        group('transmission', withModel),
        group('fuelType', withModel),
        group('primaryDamage', withModel),
        group('vehicleStatus', withModel),
        group('saleDocument', withModel),
        group('color', withModel),
        group('cylinders', withModel),
        group('drivelineType', withModel),
        group('branchName', withModel),
        group('seller', withModel),
        group('startCode', withModel),
        this.prisma.iaaiListing.groupBy({ by: ['runAndDrive', 'startCode'], where: withModel, _count: { _all: true } }),
        this.prisma.iaaiListing.groupBy({ by: ['saleDocument'], where: withModel, _count: { _all: true } }),
        this.titleMapping.getOverrides(),
      ]);
    const catCounts = new Map<string, number>();
    for (const r of titleRows) {
      const cat = deriveTitleCategory(r.saleDocument, overrides);
      catCounts.set(cat, (catCounts.get(cat) ?? 0) + r._count._all);
    }
    const rdMap = new Map<string, number>();
    for (const r of rd) {
      const k = runsDrivesOf(r);
      if (k) rdMap.set(k, (rdMap.get(k) ?? 0) + r._count._all);
    }
    const value = {
      sources: [{ key: 'iaai', count: total }],
      makes, models, trims, years, states, bodyTypes, transmissions, fuelTypes, damageTypes, saleStatuses, titleTypes,
      titleCategories: [...catCounts].map(([key, count]) => ({ key, count })), colors, cylinders, drivetrains, sellerCategories: [], yards, sellers, lotCondCodes,
      runsDrivesOptions: [...rdMap].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
      saleLights: [],
    };
    this.facetCache.set(key, { at: Date.now(), value });
    return value;
  }

  private async where(q: SearchAuctionsDto): Promise<Prisma.IaaiListingWhereInput> {
    const and: Prisma.IaaiListingWhereInput[] = [];
    const list = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(',') : []).map((s) => String(s).trim()).filter(Boolean);
    const inList = (field: string, v: unknown) => {
      const l = list(v);
      if (l.length) and.push({ [field]: { in: l } });
    };
    const num = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));

    if (!q.discarded) and.push({ isActive: true });
    const term = q.search?.trim();
    if (term) {
      and.push({
        OR: [
          { stockNumber: { contains: term } },
          { vin: { contains: term.toUpperCase() } },
          { make: { contains: term, mode: 'insensitive' } },
          { model: { contains: term, mode: 'insensitive' } },
          { series: { contains: term, mode: 'insensitive' } },
        ],
      });
    }
    const ids = list(q.sourceIds).concat(list(q.ids).map((id) => id.replace(/^iaai-/, '')));
    if (ids.length) and.push({ stockNumber: { in: ids } });
    if (q.vin) and.push({ vin: { contains: q.vin.toUpperCase() } });
    if (num(q.year)) and.push({ year: num(q.year) });
    if (num(q.yearMin) || num(q.yearMax)) and.push({ year: { gte: num(q.yearMin), lte: num(q.yearMax) } });
    inList('make', q.make);
    inList('model', q.model);
    inList('series', q.trim);
    inList('bodyStyle', q.bodyType);
    inList('branchName', q.yardName);
    inList('seller', q.sellerName);
    inList('drivelineType', q.drivetrain);
    inList('color', q.color);
    inList('cylinders', q.cylinders);
    inList('locationState', q.locationState);
    inList('primaryDamage', q.damageDescription);
    inList('saleDocument', q.saleTitleType);
    const byCategory = await this.titleCategoryWhere(list(q.titleCategory));
    if (byCategory) and.push(byCategory);
    if (q.transmission) and.push({ transmission: q.transmission });
    if (q.fuelType) and.push({ fuelType: q.fuelType });
    if (q.saleStatus) and.push({ vehicleStatus: q.saleStatus });
    if (q.lotCondCode) and.push({ startCode: q.lotCondCode });
    if (num(q.odometerMin) !== undefined || num(q.odometerMax) !== undefined) and.push({ odometer: { gte: num(q.odometerMin), lte: num(q.odometerMax) } });
    if (num(q.priceMin) !== undefined || num(q.priceMax) !== undefined) and.push({ currentBid: { gte: num(q.priceMin), lte: num(q.priceMax) } });
    if (q.hasBuyItNow) and.push({ buyNowPrice: { gt: 0 } });
    if (q.hasKeys) {
      const yes = /^(y|yes|true|present)$/i.test(q.hasKeys);
      and.push({ keys: yes ? 'PRESENT' : { not: 'PRESENT' } });
    }
    if (q.runsDrives) {
      and.push(q.runsDrives === 'Run & Drive' ? { runAndDrive: true } : { startCode: q.runsDrives, NOT: { runAndDrive: true } });
    }
    if (num(q.saleDateFrom) || num(q.saleDateTo)) {
      const to = num(q.saleDateTo);
      and.push({
        auctionAt: {
          ...(num(q.saleDateFrom) && { gte: centralDayStart(num(q.saleDateFrom)!) }),
          ...(to && { lt: new Date(centralDayStart(to).getTime() + 86400_000) }),
        },
      });
    }
    return and.length ? { AND: and } : {};
  }

  /** One IAAI lot in the AuctionListing shape the auction page renders. */
  private toListing(r: Row) {
    const cached = r.images as { images?: { thumbnail: string; fullSize: string }[] } | null;
    const gallery = cached?.images?.length ? cached.images : iaaiGalleryImages(r.imageSourceUrls);
    return {
      // Prefixed so it never equals a Copart listing id in the page's caches and React keys.
      id: `iaai-${r.stockNumber}`,
      source: 'iaai' as const,
      sourceId: r.stockNumber,
      vin: r.vin,
      year: r.year,
      make: r.make,
      model: r.model,
      trim: r.series,
      bodyType: r.bodyStyle,
      color: r.color,
      interiorColor: null,
      engine: r.engineSize,
      transmission: r.transmission,
      fuelType: r.fuelType,
      drivetrain: r.drivelineType,
      cylinders: r.cylinders,
      odometer: r.odometer,
      locationCity: r.locationCity,
      locationState: r.locationState,
      locationZip: r.locationZip,
      locationCountry: 'US',
      images: gallery.map((g) => g.thumbnail),
      mainImage: gallery[0]?.thumbnail ?? null,
      createdAt: r.firstSeenAt,
      updatedAt: r.updatedAt,
      indexedAt: r.lastSeenAt,
      damageDescription: r.primaryDamage,
      secondaryDamage: r.secondaryDamage,
      ...iaaiSaleParts(r.auctionAt),
      saleStatus: r.vehicleStatus,
      saleTitleState: r.certState,
      saleTitleType: r.saleDocument,
      hasKeys: r.keys === 'PRESENT' ? 'YES' : r.keys ? 'NO' : null,
      runsDrives: runsDrivesOf(r),
      lotCondCode: r.startCode,
      wholesale: null,
      saleLight: null,
      discarded: !r.isActive,
      highBid: r.currentBid,
      buyItNowPrice: r.buyNowPrice,
      estRetailValue: r.acv,
      repairCost: r.repairCost,
      yardName: r.branchName,
      yardNumber: r.branchCode,
      itemNumber: null,
      sellerName: r.seller,
      photosCached: !!cached?.images?.length,
      lossType: r.lossType,
      odometerStatus: r.odometerStatus,
      auctionAt: r.auctionAt,
    };
  }
}
