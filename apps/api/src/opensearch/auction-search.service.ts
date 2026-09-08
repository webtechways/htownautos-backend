import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OpenSearchService, AUCTION_INDEX_NAME, AuctionSyncService } from '@htownautos/opensearch';
import type { UnifiedAuction, AuctionAggregations, AuctionSearchResult } from '@htownautos/opensearch';
import { PrismaService } from '@htownautos/prisma';
import { RabbitMQService } from '@htownautos/rabbitmq';
import { CopartImagesService, GALLERY_CACHE_QUEUE, codesForTitleCategories, deriveTitleCategory, allKnownCodes, geocodeZip, boundingBox, normalizeToken, houstonSaleDate } from '@htownautos/common';
import type { TitleCategory, TitleOverrides, GalleryImage, GalleryResponse, GalleryCacheMessage } from '@htownautos/common';
import { TitleMappingService } from '../title-mapping/title-mapping.service';
import { AuctionAnalysisType, Prisma } from '@prisma/client';
import { SearchAuctionsDto } from './dto/search-auctions.dto';

export interface DiscardFields {
  discarded: boolean;
  discardReason: string | null;
  discardedAt: Date | null;
}

/** Normalize incoming filter values so they match the canonical `.keyword` fields. */
function canonTerms(values: string[]): string[] {
  return values
    .map((v) => normalizeToken(v))
    .filter((v): v is string => !!v);
}

// Gallery image/response types + the queue contract now live in @htownautos/common
// (shared with the data-sync crawler and image-service consumer).

// Internal cache structure stored in DB (public S3 URLs).
interface GalleryCacheData {
  lotNumber: string;
  imageCount: number;
  images: { sequence: number; thumbnail: string; fullSize: string }[];
}

/**
 * Facets the sidebar offers as multi-select. Each one's aggregation is computed
 * with its own filter removed so the remaining options stay visible and
 * selectable (see buildQuery's `omitFacet`).
 */
type FacetKey =
  | 'source'
  | 'make'
  | 'model'
  | 'trim'
  | 'bodyType'
  | 'yardName'
  | 'sellerName'
  | 'sellerCategory'
  | 'drivetrain'
  | 'color'
  | 'cylinders'
  | 'locationState'
  | 'damageDescription'
  | 'saleLight'
  | 'transmission'
  | 'fuelType'
  | 'title';

/** aggregation name → the facet whose filter it must ignore. */
const AGG_FACETS: Record<string, FacetKey> = {
  sources: 'source',
  makes: 'make',
  models: 'model',
  trims: 'trim',
  bodyTypes: 'bodyType',
  yards: 'yardName',
  sellers: 'sellerName',
  sellerCategories: 'sellerCategory',
  drivetrains: 'drivetrain',
  colors: 'color',
  cylinders: 'cylinders',
  states: 'locationState',
  damageTypes: 'damageDescription',
  saleLights: 'saleLight',
  transmissions: 'transmission',
  fuelTypes: 'fuelType',
  titleTypes: 'title',
};

@Injectable()
export class AuctionSearchService {
  private readonly logger = new Logger(AuctionSearchService.name);

  constructor(
    private readonly openSearchService: OpenSearchService,
    private readonly prisma: PrismaService,
    private readonly rabbitMQ: RabbitMQService,
    private readonly copartImages: CopartImagesService,
    private readonly syncService: AuctionSyncService,
    private readonly titleMapping: TitleMappingService,
  ) {}

  async search(dto: SearchAuctionsDto): Promise<AuctionSearchResult> {
    const { page = 1, limit = 25, sortBy = 'createdAt', sortOrder = 'desc' } = dto;
    const from = (page - 1) * limit;

    // If hasCarfaxReport filter is active, get listing IDs with carfax reports from DB
    let carfaxSourceIds: string[] | undefined;
    if (dto.hasCarfaxReport) {
      const carfaxListingIds = await this.prisma.carfaxReport.findMany({
        select: { auctionListingId: true },
        distinct: ['auctionListingId'],
      });
      carfaxSourceIds = carfaxListingIds.map((r) => r.auctionListingId.toString());
      if (carfaxSourceIds.length === 0) {
        return {
          data: [],
          meta: { page, limit, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false },
        };
      }
    }

    // If inspectableOnly filter is active, resolve yard names from DB (no reindex needed —
    // yardName is already indexed; we filter via terms query on the existing field)
    let inspectableYardNames: string[] | undefined;
    if (dto.inspectableOnly) {
      const yards = await this.prisma.yard.findMany({
        where: { physicalInspectionAvailable: true },
        select: { name: true },
      });
      inspectableYardNames = yards.map((y) => y.name);
      // If no yards are inspection-enabled, return empty immediately — the terms filter
      // with an empty array would match nothing anyway, but short-circuiting is cleaner.
      if (inspectableYardNames.length === 0) {
        return {
          data: [],
          meta: { page, limit, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false },
        };
      }
    }

    // Learned title-code → category overrides (staff assignments)
    const titleOverrides = await this.titleMapping.getOverrides();

    // Build query
    const query = this.buildQuery(dto, carfaxSourceIds, inspectableYardNames, titleOverrides);

    // Build sort
    const sort = this.buildSort(sortBy, sortOrder);

    // Build aggregations if requested
    const aggs = dto.includeAggregations
      ? this.buildAggregations(dto, carfaxSourceIds, inspectableYardNames, titleOverrides)
      : undefined;

    const searchBody: any = {
      from,
      size: limit,
      query,
      sort,
      track_total_hits: true,
    };

    // Exact VIN search: multiple lots can share a VIN (relisted). Collapse to one
    // per VIN and keep the most recently published lot (newest createdAt first);
    // the older ones are historical.
    const isVinSearch = this.classifySearch(dto.search).kind === 'vin';
    if (isVinSearch) {
      searchBody.collapse = { field: 'vin.keyword' };
      searchBody.sort = [
        { createdAt: { order: 'desc', unmapped_type: 'long' } },
        { _score: { order: 'desc' } },
      ];
    }

    if (aggs) {
      searchBody.aggs = aggs;
    }

    try {
      const result = await this.openSearchService.search(AUCTION_INDEX_NAME, searchBody);

      const data: UnifiedAuction[] = result.hits.hits.map((hit: any) => hit._source);

      // With collapse, hits.total counts raw (pre-collapse) docs; the collapsed
      // result set is what we actually return, so report its size.
      const total = isVinSearch ? data.length : result.hits.total.value || 0;
      const totalPages = Math.ceil(total / limit) || 1;

      const response: AuctionSearchResult = {
        data,
        meta: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      };

      if (dto.includeAggregations && result.aggregations) {
        response.aggregations = this.parseAggregations(result.aggregations, titleOverrides);
      }

      return response;
    } catch (error) {
      this.logger.error(`Search error: ${error.message}`);
      throw error;
    }
  }

  /**
   * "Today" as the YYYYMMDD integer the index stores, in **Houston Central** —
   * the timezone the auction business (and every sale date) runs on.
   *
   * The container's clock is UTC, so a plain `new Date()` rolls over at 19:00
   * Central and the browse view starts hiding the current day's lots five hours
   * early — which also made an explicit "sale date = today" filter return zero.
   */
  private getTodayAsInt(): number {
    return houstonSaleDate();
  }

  /**
   * Classify a free-text search box query so we match exactly:
   * - all-digits → a lot number (unique → one result)
   * - 17-char alphanumeric → a VIN (exact; collapsed to the latest lot)
   * - anything else → free text (make/model/…)
   */
  private classifySearch(q?: string): { kind: 'lot' | 'vin' | 'text'; value: string } {
    const v = (q ?? '').trim();
    if (!v) return { kind: 'text', value: v };
    // Copart lot numbers are 6+ digits; keep short numerics (e.g. a year) as text.
    if (/^\d{6,}$/.test(v)) return { kind: 'lot', value: v };
    if (/^[A-Za-z0-9]{17}$/.test(v)) return { kind: 'vin', value: v.toUpperCase() };
    return { kind: 'text', value: v };
  }

  /**
   * `omitFacet` drops one facet's own clause from the query. Faceted search needs
   * this: with the make filter applied, a `makes` aggregation computed over the
   * filtered result set can only ever return the makes already selected, so the
   * other options vanish from the sidebar and multi-select becomes impossible.
   * Every other filter still applies, which keeps the counts honest.
   */
  private buildQuery(
    dto: SearchAuctionsDto,
    carfaxSourceIds?: string[],
    inspectableYardNames?: string[],
    titleOverrides?: TitleOverrides,
    omitFacet?: FacetKey,
  ): any {
    const must: any[] = [];
    const filter: any[] = [];
    const keep = (facet: FacetKey) => omitFacet !== facet;

    // Exclude already-auctioned items from the DEFAULT browse view only
    // (keep listings with no saleDate, saleDate 0, or saleDate >= today).
    // When the user does an EXPLICIT lookup (free-text search, VIN, lot/source/ids)
    // do NOT hide past-dated lots: many stay active on Copart ("On Minimum Bid" /
    // relisted) with a stale saleDate, and the user expects to find them by VIN/lot.
    // An explicit sale-date range IS the user's intent about which days to see —
    // silently AND-ing "…and only from today onwards" on top of it made every
    // past-date range come back empty.
    const explicitLookup = !!(
      dto.search ||
      dto.vin ||
      dto.sourceIds ||
      dto.ids ||
      dto.saleDateFrom ||
      dto.saleDateTo
    );
    if (!explicitLookup) {
      filter.push({
        bool: {
          should: [
            { bool: { must_not: { exists: { field: 'saleDate' } } } },
            { term: { saleDate: 0 } },
            { range: { saleDate: { gte: this.getTodayAsInt() } } },
          ],
          minimum_should_match: 1,
        },
      });
    }

    // Full text search
    if (dto.search) {
      const s = this.classifySearch(dto.search);
      if (s.kind === 'lot') {
        // A bare lot number is unique → exact match on the lot (sourceId keyword).
        must.push({ term: { sourceId: s.value } });
      } else if (s.kind === 'vin') {
        // Exact VIN. Multiple lots can share a VIN (relisted); the search()
        // method collapses these to the latest-published one.
        must.push({ term: { 'vin.keyword': s.value } });
      } else {
        // Free text (make/model/etc.) — fuzzy multi_match + lot prefix fallback.
        must.push({
          bool: {
            should: [
              {
                multi_match: {
                  query: dto.search,
                  fields: ['vin^3', 'make^2', 'model^2', 'sourceId^2', 'damageDescription', 'heading'],
                  type: 'best_fields',
                  fuzziness: 'AUTO',
                },
              },
              { prefix: { sourceId: dto.search } },
            ],
            minimum_should_match: 1,
          },
        });
      }
    }

    // ── Exact-match filters ────────────────────────────────────────────
    //
    // Every string field in the production index is `text` with a `.keyword`
    // subfield (dynamic mapping legacy). `term/terms` queries MUST hit the
    // `.keyword` subfield — running them against the analyzed text would
    // miss any uppercase value, and lowercasing the query before sending
    // it makes things worse (the indexed keyword is case-sensitive — the
    // dropdowns show the canonical "CHEVROLET", "Pure Sale", etc.).
    // No .toLowerCase() on any of these; pass the user's selection through.

    // Source filter (text+keyword, e.g. "copart")
    if (keep('source') && dto.source && dto.source.length > 0) {
      filter.push({ terms: { 'source.keyword': dto.source } });
    }

    // Source IDs filter (for favorites by lot number)
    if (dto.sourceIds) {
      const ids = dto.sourceIds.split(',').map(id => id.trim());
      filter.push({ terms: { 'sourceId.keyword': ids } });
    }

    // IDs filter (for favorites by UUID) — UUIDs are stored as text+keyword too
    if (dto.ids) {
      const ids = dto.ids.split(',').map(id => id.trim());
      filter.push({ terms: { 'id.keyword': ids } });
    }

    // VIN filter
    if (dto.vin) {
      filter.push({ term: { 'vin.keyword': dto.vin.toUpperCase() } });
    }

    // Year filters
    if (dto.year) {
      filter.push({ term: { year: dto.year } });
    } else if (dto.yearMin || dto.yearMax) {
      const rangeQuery: any = {};
      if (dto.yearMin) rangeQuery.gte = dto.yearMin;
      if (dto.yearMax) rangeQuery.lte = dto.yearMax;
      filter.push({ range: { year: rangeQuery } });
    }

    // Make filter — canonical (values come from the canonical facet; normalize
    // for safety so old/raw inputs still match).
    if (keep('make') && dto.make && dto.make.length > 0) {
      filter.push({ terms: { 'makeCanonical.keyword': canonTerms(dto.make) } });
    }

    // Model filter — canonical
    if (keep('model') && dto.model && dto.model.length > 0) {
      filter.push({ terms: { 'modelCanonical.keyword': canonTerms(dto.model) } });
    }

    // Body type filter
    if (keep('bodyType') && dto.bodyType && dto.bodyType.length > 0) {
      filter.push({ terms: { 'bodyType.keyword': dto.bodyType } });
    }

    // Trim filter — canonical
    if (keep('trim') && dto.trim && dto.trim.length > 0) {
      filter.push({ terms: { 'trimCanonical.keyword': canonTerms(dto.trim) } });
    }

    // Yard name filter
    if (keep('yardName') && dto.yardName && dto.yardName.length > 0) {
      filter.push({ terms: { 'yardName.keyword': dto.yardName } });
    }

    // Seller name filter
    if (keep('sellerName') && dto.sellerName && dto.sellerName.length > 0) {
      filter.push({ terms: { 'sellerName.keyword': dto.sellerName } });
    }

    // Exclude unknown sellers (existence works on text fields too)
    if (dto.excludeUnknownSellers) {
      filter.push({ exists: { field: 'sellerName' } });
    }

    // Transmission filter
    if (keep('transmission') && dto.transmission) {
      filter.push({ term: { 'transmission.keyword': dto.transmission } });
    }

    // Fuel type filter
    if (keep('fuelType') && dto.fuelType) {
      filter.push({ term: { 'fuelType.keyword': dto.fuelType } });
    }

    // Drivetrain filter (multi)
    if (keep('drivetrain') && dto.drivetrain && dto.drivetrain.length > 0) {
      filter.push({ terms: { 'drivetrain.keyword': dto.drivetrain } });
    }

    // Color filter (multi) — canonical
    if (keep('color') && dto.color && dto.color.length > 0) {
      filter.push({ terms: { 'colorCanonical.keyword': canonTerms(dto.color) } });
    }

    // Cylinders filter (multi)
    if (keep('cylinders') && dto.cylinders && dto.cylinders.length > 0) {
      filter.push({ terms: { 'cylinders.keyword': dto.cylinders } });
    }

    // Source / seller category filter (multi) — derived field indexed at sync time
    if (keep('sellerCategory') && dto.sellerCategory && dto.sellerCategory.length > 0) {
      filter.push({ terms: { 'sellerCategory.keyword': dto.sellerCategory } });
    }

    // Engine size range (litres) — derived field indexed at sync time
    if (dto.engineSizeMin !== undefined || dto.engineSizeMax !== undefined) {
      const rangeQuery: any = {};
      if (dto.engineSizeMin !== undefined) rangeQuery.gte = dto.engineSizeMin;
      if (dto.engineSizeMax !== undefined) rangeQuery.lte = dto.engineSizeMax;
      filter.push({ range: { engineSizeL: rangeQuery } });
    }

    // ZIP radius — geocode center ZIP and bound by a box on the indexed
    // geoPoint.lat/geoPoint.lon (object fields under the dynamic mapping).
    // Bounding box (not geo_distance) so it works without a geo_point mapping.
    if (dto.zip && dto.radiusMiles && dto.radiusMiles > 0) {
      const center = geocodeZip(dto.zip);
      if (center) {
        const box = boundingBox(center, dto.radiusMiles);
        filter.push({ range: { 'geoPoint.lat': { gte: box.minLat, lte: box.maxLat } } });
        filter.push({ range: { 'geoPoint.lon': { gte: box.minLon, lte: box.maxLon } } });
      }
    }

    // Location state filter
    if (keep('locationState') && dto.locationState && dto.locationState.length > 0) {
      filter.push({ terms: { 'locationState.keyword': dto.locationState } });
    }

    // Odometer range
    if (dto.odometerMin !== undefined || dto.odometerMax !== undefined) {
      const rangeQuery: any = {};
      if (dto.odometerMin !== undefined) rangeQuery.gte = dto.odometerMin;
      if (dto.odometerMax !== undefined) rangeQuery.lte = dto.odometerMax;
      filter.push({ range: { odometer: rangeQuery } });
    }

    // Odometer brand filter
    if (dto.odometerBrand) {
      filter.push({ term: { 'odometerBrand.keyword': dto.odometerBrand } });
    }

    // === COPART SPECIFIC FILTERS ===

    // Damage description filter
    if (keep('damageDescription') && dto.damageDescription && dto.damageDescription.length > 0) {
      filter.push({
        terms: { 'damageDescription.keyword': dto.damageDescription },
      });
    }

    // Sale status filter
    if (dto.saleStatus) {
      filter.push({ term: { 'saleStatus.keyword': dto.saleStatus } });
    }

    // Sale title type filter (raw codes)
    if (keep('title') && dto.saleTitleType && dto.saleTitleType.length > 0) {
      filter.push({
        terms: { 'saleTitleType.keyword': dto.saleTitleType },
      });
    }

    // Primary title category filter (clean / nonrepairable / salvage / unknown).
    // Known categories → the concrete raw codes (base + learned overrides).
    // "unknown" → any doc whose code is NOT in the known set (incl. missing).
    // The prod index stores codes UPPERCASE (dynamic mapping, case-sensitive)
    // while a fresh index lowercases them (normalizer); match both cases.
    if (keep('title') && dto.titleCategory && dto.titleCategory.length > 0) {
      const bothCases = (arr: string[]) =>
        Array.from(new Set(arr.flatMap((c) => [c.toLowerCase(), c.toUpperCase()])));
      const cats = dto.titleCategory;
      const known = cats.filter((c) => c !== 'unknown');
      const wantUnknown = cats.includes('unknown');
      const should: any[] = [];

      if (known.length > 0) {
        const codes = codesForTitleCategories(known, titleOverrides);
        if (codes.length > 0) should.push({ terms: { 'saleTitleType.keyword': bothCases(codes) } });
      }
      if (wantUnknown) {
        should.push({
          bool: { must_not: { terms: { 'saleTitleType.keyword': bothCases(allKnownCodes(titleOverrides)) } } },
        });
      }
      if (should.length === 1) {
        filter.push(should[0]);
      } else if (should.length > 1) {
        filter.push({ bool: { should, minimum_should_match: 1 } });
      }
    }

    // Has keys filter
    if (dto.hasKeys) {
      filter.push({ term: { 'hasKeys.keyword': dto.hasKeys } });
    }

    // Runs/Drives filter
    if (dto.runsDrives) {
      filter.push({ term: { 'runsDrives.keyword': dto.runsDrives } });
    }

    // Lot condition code filter
    if (dto.lotCondCode) {
      filter.push({ term: { 'lotCondCode.keyword': dto.lotCondCode } });
    }

    // Wholesale filter
    if (dto.wholesale) {
      filter.push({ term: { 'wholesale.keyword': dto.wholesale } });
    }

    // Sale light filter
    if (keep('saleLight') && dto.saleLight && dto.saleLight.length > 0) {
      filter.push({ terms: { 'saleLight.keyword': dto.saleLight } });
    }

    // Buy-It-Now filter (only listings with a buy-it-now price > 0)
    if (dto.hasBuyItNow) {
      filter.push({ range: { buyItNowPrice: { gt: 0 } } });
    }

    // Price range (estRetailValue)
    if (dto.priceMin !== undefined || dto.priceMax !== undefined) {
      const rangeQuery: any = {};
      if (dto.priceMin !== undefined) rangeQuery.gte = dto.priceMin;
      if (dto.priceMax !== undefined) rangeQuery.lte = dto.priceMax;
      filter.push({ range: { estRetailValue: rangeQuery } });
    }

    // Sale date range
    if (dto.saleDateFrom || dto.saleDateTo) {
      const rangeQuery: any = {};
      if (dto.saleDateFrom) rangeQuery.gte = dto.saleDateFrom;
      if (dto.saleDateTo) rangeQuery.lte = dto.saleDateTo;
      filter.push({ range: { saleDate: rangeQuery } });
    }

    // === MARKETCHECK SPECIFIC FILTERS ===

    // Carfax clean title
    if (dto.carfaxCleanTitle !== undefined) {
      filter.push({ term: { carfaxCleanTitle: dto.carfaxCleanTitle } });
    }

    // Carfax 1 owner
    if (dto.carfax1Owner !== undefined) {
      filter.push({ term: { carfax1Owner: dto.carfax1Owner } });
    }

    // Days on market max
    if (dto.domMax !== undefined) {
      filter.push({ range: { dom: { lte: dto.domMax } } });
    }

    // Carfax report existence filter (IDs resolved from PostgreSQL)
    if (carfaxSourceIds && carfaxSourceIds.length > 0) {
      filter.push({ terms: { 'sourceId.keyword': carfaxSourceIds } });
    }

    // Discarded filter — only applied when explicitly true; omitting it shows all lots
    // (docs without the field are treated as not-discarded by OpenSearch, which is correct
    // for the 583k legacy docs that predate this field)
    if (dto.discarded === true) {
      filter.push({ term: { discarded: true } });
    }

    // Inspectable-yard filter — yard names resolved from Postgres before buildQuery is called
    // (yardName is already indexed on all existing docs — no reindex required)
    if (inspectableYardNames && inspectableYardNames.length > 0) {
      filter.push({ terms: { 'yardName.keyword': inspectableYardNames } });
    }

    // Build final query
    if (must.length === 0 && filter.length === 0) {
      return { match_all: {} };
    }

    return {
      bool: {
        ...(must.length > 0 && { must }),
        ...(filter.length > 0 && { filter }),
      },
    };
  }

  private buildSort(sortBy: string, sortOrder: 'asc' | 'desc'): any[] {
    const sortField = this.getSortField(sortBy);
    return [
      { [sortField]: { order: sortOrder, unmapped_type: 'long' } },
      { _score: { order: 'desc' } },
    ];
  }

  private getSortField(sortBy: string): string {
    // Same rule as filters: sorting on a text field throws — use the
    // .keyword subfield for every string. Numeric / date fields plain.
    const fieldMap: Record<string, string> = {
      year: 'year',
      make: 'make.keyword',
      odometer: 'odometer',
      saleDate: 'saleDate',
      highBid: 'highBid',
      estRetailValue: 'estRetailValue',
      createdAt: 'createdAt',
      dom: 'dom',
      locationState: 'locationState.keyword',
      saleTitleType: 'saleTitleType.keyword',
    };
    return fieldMap[sortBy] || 'createdAt';
  }

  /**
   * Wraps any facet the user is currently filtering on in a `filter` aggregation
   * that re-applies every OTHER filter. Untouched facets stay as plain aggs under
   * the main query, so the extra work is proportional to the filters in use —
   * usually one or two, not seventeen.
   */
  private buildAggregations(
    dto: SearchAuctionsDto,
    carfaxSourceIds?: string[],
    inspectableYardNames?: string[],
    titleOverrides?: TitleOverrides,
  ): any {
    const base = this.baseAggregations();
    const out: any = {};

    for (const [aggName, definition] of Object.entries(base)) {
      const facet = AGG_FACETS[aggName];
      if (!facet || !this.facetIsActive(dto, facet)) {
        out[aggName] = definition;
        continue;
      }
      // `global` first: aggregations are scoped to the main query, and a plain
      // `filter` sub-agg can only narrow that scope — never widen it back to the
      // options the user has not picked yet. Verified against the production
      // index: without `global` the makes facet still returned only TOYOTA.
      out[aggName] = {
        global: {},
        aggs: {
          scoped: {
            filter: this.buildQuery(
              dto,
              carfaxSourceIds,
              inspectableYardNames,
              titleOverrides,
              facet,
            ),
            aggs: { unfiltered: definition },
          },
        },
      };
    }

    return out;
  }

  /** True when the user has an active selection on this facet. */
  private facetIsActive(dto: SearchAuctionsDto, facet: FacetKey): boolean {
    switch (facet) {
      case 'title':
        return (
          (dto.saleTitleType?.length ?? 0) > 0 || (dto.titleCategory?.length ?? 0) > 0
        );
      case 'transmission':
        return !!dto.transmission;
      case 'fuelType':
        return !!dto.fuelType;
      default: {
        const value = (dto as any)[facet];
        return Array.isArray(value) ? value.length > 0 : !!value;
      }
    }
  }

  private baseAggregations(): any {
    // The production index was first created by OpenSearch's dynamic
    // mapping, which produces every string field as `text` with a
    // `.keyword` subfield. Aggregations / sorts must hit the keyword
    // subfield — running `terms { field: 'source' }` against a text
    // field fails with `illegal_argument_exception`. Numeric / date
    // fields (year) stay plain.
    return {
      sources: {
        terms: { field: 'source.keyword', size: 10 },
      },
      makes: {
        terms: { field: 'makeCanonical.keyword', size: 50 },
      },
      models: {
        terms: { field: 'modelCanonical.keyword', size: 100 },
      },
      trims: {
        terms: { field: 'trimCanonical.keyword', size: 100 },
      },
      years: {
        terms: { field: 'year', size: 30, order: { _key: 'desc' } },
      },
      states: {
        terms: { field: 'locationState.keyword', size: 60 },
      },
      bodyTypes: {
        terms: { field: 'bodyType.keyword', size: 20 },
      },
      transmissions: {
        terms: { field: 'transmission.keyword', size: 10 },
      },
      fuelTypes: {
        terms: { field: 'fuelType.keyword', size: 10 },
      },
      damageTypes: {
        terms: { field: 'damageDescription.keyword', size: 30 },
      },
      saleStatuses: {
        terms: { field: 'saleStatus.keyword', size: 10 },
      },
      titleTypes: {
        terms: { field: 'saleTitleType.keyword', size: 40 },
      },
      colors: {
        terms: { field: 'colorCanonical.keyword', size: 40 },
      },
      cylinders: {
        terms: { field: 'cylinders.keyword', size: 20 },
      },
      drivetrains: {
        terms: { field: 'drivetrain.keyword', size: 20 },
      },
      sellerCategories: {
        terms: { field: 'sellerCategory.keyword', size: 10 },
      },
      yards: {
        terms: { field: 'yardName.keyword', size: 100 },
      },
      sellers: {
        terms: { field: 'sellerName.keyword', size: 200 },
      },
      lotCondCodes: {
        terms: { field: 'lotCondCode.keyword', size: 20 },
      },
      runsDrivesOptions: {
        terms: { field: 'runsDrives.keyword', size: 10 },
      },
      saleLights: {
        terms: { field: 'saleLight.keyword', size: 10 },
      },
    };
  }

  private parseAggregations(aggs: any, titleOverrides?: TitleOverrides): AuctionAggregations {
    // A facet the user is filtering on comes back wrapped in a `filter` agg (see
    // buildAggregations), so its buckets sit one level deeper.
    const bucketsOf = (agg: any): any[] =>
      agg?.buckets ?? agg?.scoped?.unfiltered?.buckets ?? [];

    const parseBuckets = (buckets: any[]): Array<{ key: any; count: number }> => {
      return (buckets || []).map((bucket) => ({
        key: bucket.key,
        count: bucket.doc_count,
      }));
    };

    // Roll raw title-type buckets up into the primary categories (incl. unknown).
    const titleTypeBuckets = parseBuckets(bucketsOf(aggs.titleTypes));
    const categoryCounts: Record<TitleCategory, number> = {
      clean: 0,
      nonrepairable: 0,
      salvage: 0,
      unknown: 0,
    };
    for (const b of titleTypeBuckets) {
      categoryCounts[deriveTitleCategory(String(b.key), titleOverrides)] += b.count;
    }
    const titleCategories = (Object.keys(categoryCounts) as TitleCategory[])
      .map((key) => ({ key, count: categoryCounts[key] }))
      .filter((b) => b.count > 0);

    // A handful of malformed Copart CSV rows land a Sale-Status value (or a bare
    // number) in the Runs/Drives column. Keep the Runs/Drives facet clean by
    // dropping numeric-only keys and any key that is really a Sale Status — this
    // preserves every legit value (Run & Drive Verified, DEFAULT, Vehicle
    // Starts, …) without a brittle whitelist. See [[copart-csv-parser-bug]].
    const saleStatuses = parseBuckets(bucketsOf(aggs.saleStatuses));
    const saleStatusKeys = new Set(
      saleStatuses.map((b) => String(b.key).trim().toLowerCase()),
    );
    const isNumericLike = (s: string) => /^-?\d+(?:\.\d+)?$/.test(s);
    const runsDrivesOptions = parseBuckets(bucketsOf(aggs.runsDrivesOptions)).filter((b) => {
      const key = String(b.key).trim();
      if (!key) return false;
      if (isNumericLike(key)) return false;
      if (saleStatusKeys.has(key.toLowerCase())) return false;
      return true;
    });

    return {
      sources: parseBuckets(bucketsOf(aggs.sources)),
      makes: parseBuckets(bucketsOf(aggs.makes)),
      models: parseBuckets(bucketsOf(aggs.models)),
      trims: parseBuckets(bucketsOf(aggs.trims)),
      years: parseBuckets(bucketsOf(aggs.years)),
      states: parseBuckets(bucketsOf(aggs.states)),
      bodyTypes: parseBuckets(bucketsOf(aggs.bodyTypes)),
      transmissions: parseBuckets(bucketsOf(aggs.transmissions)),
      fuelTypes: parseBuckets(bucketsOf(aggs.fuelTypes)),
      damageTypes: parseBuckets(bucketsOf(aggs.damageTypes)),
      saleStatuses,
      titleTypes: titleTypeBuckets,
      titleCategories,
      colors: parseBuckets(bucketsOf(aggs.colors)),
      cylinders: parseBuckets(bucketsOf(aggs.cylinders)),
      drivetrains: parseBuckets(bucketsOf(aggs.drivetrains)),
      sellerCategories: parseBuckets(bucketsOf(aggs.sellerCategories)),
      yards: parseBuckets(bucketsOf(aggs.yards)),
      sellers: parseBuckets(bucketsOf(aggs.sellers)),
      lotCondCodes: parseBuckets(bucketsOf(aggs.lotCondCodes)),
      runsDrivesOptions,
      saleLights: parseBuckets(bucketsOf(aggs.saleLights)),
    };
  }

  /**
   * Get filter options (distinct values) for building UI filters
   * Supports cascading filters - when make is selected, models are filtered to that make
   */
  async getFilterOptions(dto?: SearchAuctionsDto): Promise<AuctionAggregations> {
    const titleOverrides = await this.titleMapping.getOverrides();
    // Build query based on current filter selections for cascading
    const query = dto ? this.buildQuery(dto, undefined, undefined, titleOverrides) : { match_all: {} };

    const searchBody: any = {
      size: 0,
      query,
      // Same rule as the main search: a facet the user is filtering on must not
      // filter its own option list, or it collapses to the current selection.
      aggs: dto
        ? this.buildAggregations(dto, undefined, undefined, titleOverrides)
        : this.baseAggregations(),
    };

    try {
      const result = await this.openSearchService.search(AUCTION_INDEX_NAME, searchBody);
      return this.parseAggregations(result.aggregations, titleOverrides);
    } catch (error) {
      this.logger.error(`Error getting filter options: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get a single auction by ID
   */
  async findById(id: string): Promise<UnifiedAuction | null> {
    try {
      const client = this.openSearchService.getClient();
      const result = await client.get({
        index: AUCTION_INDEX_NAME,
        id,
      });
      return (result.body._source as UnifiedAuction) ?? null;
    } catch (error) {
      if (error.meta?.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get auction by source and sourceId.
   * For copart listings the OpenSearch doc may not carry the new discard fields
   * (index not yet reindexed). We always merge the authoritative discard state
   * from Postgres so the detail view reflects it immediately after a discard/un-discard.
   */
  async findBySourceId(source: 'copart' | 'iaai', sourceId: string): Promise<(Omit<UnifiedAuction, 'discarded' | 'discardReason' | 'discardedAt'> & DiscardFields) | null> {
    const id = `${source}_${sourceId}`;
    const doc = await this.findById(id);
    if (!doc) return null;

    // Merge discard fields from Postgres (authoritative source)
    const discardFields = await this.getDiscardFields(sourceId);
    return {
      ...doc,
      discarded: discardFields?.discarded ?? false,
      discardReason: discardFields?.discardReason ?? null,
      discardedAt: discardFields?.discardedAt ?? null,
    };
  }

  /**
   * Fetch only the discard fields for a lot from Postgres.
   * Returns null when the lot does not exist (e.g. non-copart source).
   */
  async getDiscardFields(sourceId: string): Promise<DiscardFields | null> {
    let lotNumber: bigint;
    try {
      lotNumber = BigInt(sourceId);
    } catch {
      return null;
    }
    const row = await this.prisma.auctionListing.findUnique({
      where: { lotNumber },
      select: { discarded: true, discardReason: true, discardedAt: true },
    });
    if (!row) return null;
    return {
      discarded: row.discarded,
      discardReason: row.discardReason,
      discardedAt: row.discardedAt,
    };
  }

  /**
   * Set or clear the discarded state for a Copart lot.
   * @param sourceId  The lot number as a string.
   * @param discarded Whether to mark or unmark as discarded.
   * @param reason    Optional reason (only stored when discarded=true).
   * @param userId    Clerk user ID of the acting staff member (stored for audit).
   */
  async discardListing(
    sourceId: string,
    discarded: boolean,
    reason: string | undefined,
    userId: string | null,
  ): Promise<{ lotNumber: string; discarded: boolean; discardReason: string | null; discardedAt: Date | null }> {
    const lotNumber = BigInt(sourceId);

    const existing = await this.prisma.auctionListing.findUnique({
      where: { lotNumber },
      select: { lotNumber: true },
    });
    if (!existing) {
      throw new NotFoundException(`Auction listing ${sourceId} not found`);
    }

    const updated = await this.prisma.auctionListing.update({
      where: { lotNumber },
      data: {
        discarded,
        discardReason: discarded ? (reason ?? null) : null,
        discardedAt: discarded ? new Date() : null,
        discardedById: discarded ? (userId ?? null) : null,
      },
      select: { lotNumber: true, discarded: true, discardReason: true, discardedAt: true },
    });

    // Best-effort reindex so browse/search list can badge discarded lots
    try {
      const full = await this.prisma.auctionListing.findUnique({ where: { lotNumber } });
      if (full) await this.syncService.indexCopartListing(full);
    } catch (err) {
      this.logger.warn(`[Discard] Reindex failed for lot ${sourceId}: ${(err as Error).message}`);
    }

    return {
      lotNumber: updated.lotNumber.toString(),
      discarded: updated.discarded,
      discardReason: updated.discardReason,
      discardedAt: updated.discardedAt,
    };
  }

  /**
   * Scrape autobidmaster.com to refresh the current high bid for a Copart lot.
   * The Copart CSV doesn't carry a current bid, so users trigger this on demand
   * from the listing detail page. We persist to Postgres and reindex the single
   * doc so the next read from OpenSearch reflects the new value.
   *
   * The autobidmaster page is JS/cookie gated; passing `?fallback=true` together
   * with a `screenSize` cookie skips the bootstrap challenge and serves SSR
   * HTML containing the `qa_current_bid` element.
   */
  async refreshHighBid(
    lotNumberStr: string,
  ): Promise<{ lotNumber: string; highBid: number | null }> {
    this.logger.log(`[BidRefresh] === Start lot ${lotNumberStr} ===`);
    const lotNumber = BigInt(lotNumberStr);
    const listing = await this.prisma.auctionListing.findUnique({
      where: { lotNumber },
    });
    if (!listing) {
      this.logger.warn(`[BidRefresh] Listing ${lotNumberStr} not found in DB`);
      throw new NotFoundException(`Auction listing ${lotNumberStr} not found`);
    }
    this.logger.log(
      `[BidRefresh] Current DB highBid: ${listing.highBid?.toString() ?? 'null'}`,
    );

    const url = `https://www.autobidmaster.com/en/search/lot/${lotNumberStr}/?fallback=true`;
    this.logger.log(`[BidRefresh] Fetching ${url}`);
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        Cookie: 'screenSize=1920x1080; cookietest=1',
      },
      redirect: 'follow',
    });
    this.logger.log(
      `[BidRefresh] HTTP ${res.status} ${res.statusText} (final url: ${res.url})`,
    );
    if (!res.ok) {
      throw new Error(`autobidmaster returned ${res.status}`);
    }
    const html = await res.text();
    this.logger.log(`[BidRefresh] HTML size: ${html.length} bytes`);

    const matchIdx = html.indexOf('qa_current_bid');
    if (matchIdx === -1) {
      this.logger.warn(
        `[BidRefresh] qa_current_bid NOT present in HTML for lot ${lotNumberStr}. ` +
          `First 400 chars: ${html.slice(0, 400)}`,
      );
    } else {
      const snippet = html.slice(Math.max(0, matchIdx - 80), matchIdx + 250);
      this.logger.log(`[BidRefresh] qa_current_bid snippet: ${snippet}`);
    }

    const highBid = parseAutobidmasterHighBid(html);
    this.logger.log(`[BidRefresh] Parsed highBid: ${highBid}`);

    const updated = await this.prisma.auctionListing.update({
      where: { lotNumber },
      data: { highBid },
    });
    this.logger.log(
      `[BidRefresh] DB updated. New highBid: ${updated.highBid?.toString() ?? 'null'}`,
    );

    try {
      const ok = await this.syncService.indexCopartListing(updated);
      this.logger.log(`[BidRefresh] Reindex result: ${ok}`);
    } catch (err) {
      this.logger.warn(
        `[BidRefresh] Failed to reindex lot ${lotNumberStr}: ${(err as Error).message}`,
      );
    }

    this.logger.log(`[BidRefresh] === Done lot ${lotNumberStr} → ${highBid} ===`);
    return { lotNumber: lotNumberStr, highBid };
  }

  /**
   * Lo primero que pide el dashboard al arrancar, asi que su latencia es la
   * sensacion de "la app tarda en levantar".
   *
   * Antes era un `aggregate` con `_max(updatedAt)` y `_count`: dos escaneos
   * completos con las columnas JSON de la tabla detras. Tardaba 35 segundos.
   *
   * El maximo ya sale del indice.
   *
   * El total ya no se calcula en la peticion. Dos motivos: **el dashboard no lo
   * usa** —el "306.018 listings" de la cabecera sale de `meta.total` del
   * buscador— y la estimacion del planificador daba 1,5M frente a 306k reales,
   * porque la tabla arrastra unas cinco veces su tamaño en tuplas muertas.
   *
   * Se mantiene el campo por si algo fuera de esta app lo lee, pero se refresca
   * por detras y como mucho una vez por hora.
   */
  private lastSync: { lastSyncAt: Date | null; totalListings: number | null } = {
    lastSyncAt: null,
    totalListings: null,
  };
  private countedAt = 0;
  private counting = false;

  /**
   * El conteo exacto tarda decenas de segundos sobre esta tabla, asi que se hace
   * fuera de la peticion y nunca la bloquea. Espaciado a una hora porque nadie
   * en la app lo mira.
   */
  private refreshCount() {
    if (this.counting || Date.now() - this.countedAt < 60 * 60_000) return;
    this.counting = true;
    this.prisma.auctionListing
      .count()
      .then((total) => {
        this.lastSync.totalListings = total;
        this.countedAt = Date.now();
      })
      .catch((e) => this.logger.warn(`[LastSync] conteo fallido: ${e.message}`))
      .finally(() => {
        this.counting = false;
      });
  }

  async getLastSyncTime() {
    // Del indice: es un salto al final, no un escaneo.
    const latest = await this.prisma.auctionListing.findFirst({
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    });
    this.lastSync.lastSyncAt = latest?.updatedAt ?? null;

    this.refreshCount();

    // En el primer arranque todavia no hay conteo. Se manda null en vez de una
    // estimacion inflada: un hueco un segundo es mejor que un numero falso.
    return { ...this.lastSync };
  }

  /** Bypass: fetch directly from Copart API, no cache read/write */
  async getCopartGalleryRaw(lotNumberStr: string): Promise<GalleryResponse> {
    let images: GalleryImage[] = [];
    try {
      images = await this.copartImages.fetchImages(lotNumberStr);
    } catch (err) {
      this.logger.warn(`[Gallery] Raw fetch blocked for lot ${lotNumberStr}: ${(err as Error).message}`);
    }
    return { lotNumber: lotNumberStr, imageCount: images.length, images };
  }

  /**
   * Get gallery images for a Copart listing.
   * - If galleryCache exists in DB → return public S3 URLs (no Copart call).
   *   The cache is permanent (no TTL); it's only cleared manually.
   * - If no cache → fetch from Copart, return immediately, cache to S3 in background.
   */
  async getCopartGallery(lotNumberStr: string): Promise<GalleryResponse> {
    const listing = await this.prisma.auctionListing.findUnique({
      where: { lotNumber: BigInt(lotNumberStr) },
      select: { lotNumber: true, images: true, galleryCache: true, galleryCachedAt: true },
    });

    if (!listing) {
      throw new NotFoundException(`Auction listing with lot number ${lotNumberStr} not found`);
    }

    const lotNumber = listing.lotNumber.toString();

    // --- CACHE HIT: return public S3 URLs (permanent, no expiry) ---
    if (listing.galleryCache) {
      try {
        const cached: GalleryCacheData = JSON.parse(listing.galleryCache);
        this.logger.log(`[Gallery] Cache HIT for lot ${lotNumber} (${cached.imageCount} images)`);
        return cached;
      } catch {
        this.logger.warn(`[Gallery] Invalid cache JSON for lot ${lotNumber}, refetching`);
      }
    }

    // --- CACHE MISS: fetch from Copart, publish cache job to RabbitMQ ---
    this.logger.log(`[Gallery] Cache MISS for lot ${lotNumber}, fetching from Copart`);
    let images: GalleryImage[] = [];
    try {
      images = await this.copartImages.fetchImages(lotNumber);
    } catch (err) {
      // Blocked after every retry — return an empty gallery rather than 500.
      this.logger.warn(`[Gallery] Fetch blocked for lot ${lotNumber}: ${(err as Error).message}`);
    }

    // Publish to RabbitMQ for async S3 caching (fire-and-forget, no jobId → on-demand).
    if (images.length > 0) {
      const msg: GalleryCacheMessage = { lotNumber, images };
      this.rabbitMQ.publish(GALLERY_CACHE_QUEUE, msg).catch(() => {});
    }

    return { lotNumber, imageCount: images.length, images };
  }

  // ── Analysis snapshot upsert ───────────────────────────────────────────────

  /**
   * Persist a staff-generated live analysis as an AuctionAnalysisSnapshot so the
   * read-only web / share-link views can show the data without re-calling the
   * paid external APIs. One row per (lotNumber, type); upserted on every call.
   */
  async upsertAnalysisSnapshot(
    sourceId: string,
    type: AuctionAnalysisType,
    data: Record<string, unknown>,
  ): Promise<{ ok: true }> {
    let listingId: bigint;
    try {
      listingId = BigInt(sourceId);
    } catch {
      throw new BadRequestException(`sourceId must be numeric; received "${sourceId}"`);
    }

    const jsonData = data as unknown as Prisma.InputJsonValue;
    await this.prisma.auctionAnalysisSnapshot.upsert({
      where: { auctionListingId_type: { auctionListingId: listingId, type } },
      create: { auctionListingId: listingId, type, data: jsonData },
      update: { data: jsonData },
    });

    return { ok: true };
  }

  /**
   * Read back all persisted analysis snapshots for a lot, keyed by type, so the
   * auction detail view can restore previously-generated data (auction history,
   * market check, comparables) on reload instead of starting empty.
   */
  async getAnalysisSnapshots(
    sourceId: string,
  ): Promise<{ data: Record<string, unknown> }> {
    let listingId: bigint;
    try {
      listingId = BigInt(sourceId);
    } catch {
      throw new BadRequestException(`sourceId must be numeric; received "${sourceId}"`);
    }

    const rows = await this.prisma.auctionAnalysisSnapshot.findMany({
      where: { auctionListingId: listingId },
      select: { type: true, data: true },
    });

    const map: Record<string, unknown> = {};
    for (const r of rows) map[r.type] = r.data;
    return { data: map };
  }
}

/**
 * Extract the current high bid number from autobidmaster HTML.
 * The element looks like:
 *   <strong class="... qa_current_bid ...">$1,200<span...> USD</span></strong>
 * Returns null if the element is missing or the value can't be parsed.
 */
function parseAutobidmasterHighBid(html: string): number | null {
  const match = html.match(/class="[^"]*qa_current_bid[^"]*"[^>]*>([^<]+)/);
  if (!match) return null;
  const digits = match[1].replace(/[^0-9.]/g, '');
  if (!digits) return null;
  const num = Number(digits);
  return Number.isFinite(num) ? num : null;
}
