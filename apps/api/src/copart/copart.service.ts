import { Injectable } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import { QueryCopartDto } from './dto/query-copart.dto';
import { Prisma } from '@prisma/client';
import {
  codesForTitleCategories,
  deriveTitleCategory,
  allKnownCodes,
  TITLE_CATEGORIES,
  TITLE_CATEGORY_LABELS,
  geocodeZip,
  boundingBox,
} from '@htownautos/common';
import type { TitleCategory } from '@htownautos/common';
import { TitleMappingService } from '../title-mapping/title-mapping.service';

// ── Portal filter helpers ──────────────────────────────────────────────────────

export interface Facet {
  value: string;
  label: string;
  count: number;
}

export interface FacetNum {
  value: number;
  label: string;
  count: number;
}

export interface PortalFiltersResult {
  years: FacetNum[];
  makes: Facet[];
  models: Facet[];
  trims: Facet[];
  damageTypes: Facet[];
  saleStatuses: Facet[];
  titleTypes: Facet[];
  titleCategories: Facet[];
  sources: Facet[];
  colors: Facet[];
  cylinders: Facet[];
  drivetrains: Facet[];
  bodyStyles: Facet[];
  fuelTypes: Facet[];
  transmissions: Facet[];
  states: Facet[];
  keys: Facet[];
}

/** Capitalises the first letter of every word. */
function titleCase(s: string): string {
  return s.toLowerCase().replace(/(?:^|\s)\S/g, (c) => c.toUpperCase());
}

/** Split a comma-separated multi-select value into trimmed, non-empty parts. */
function csv(s: string): string[] {
  return s
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Maps a raw saleTitleType value (case-insensitive) to a human-readable label.
 * Unknown values fall back to titleCase(rawValue).
 */
function titleTypeLabel(raw: string): string {
  const u = raw.toUpperCase();
  if (u.includes('CLEAR') || u.includes('CLEAN')) return 'Clean Title';
  if (u.includes('SALVAGE')) return 'Salvage Title';
  if (u === 'CERTIFICATE OF TITLE') return 'Certificate of Title';
  if (u.includes('NONREPAIRABLE') || u.includes('NON-REPAIRABLE') || u.includes('NON REPAIRABLE')) return 'Non-Repairable';
  if (u.includes('JUNK')) return 'Junk';
  if (u.includes('REBUILT')) return 'Rebuilt';
  if (u === 'BILL OF SALE') return 'Bill of Sale';
  if (u.includes('PARTS ONLY')) return 'Parts Only';
  return titleCase(raw);
}

/** US states + DC + common Canadian provinces that appear in Copart data. */
const STATE_MAP: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  // Canadian provinces that appear in Copart inventory
  AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador', NS: 'Nova Scotia', ON: 'Ontario',
  PE: 'Prince Edward Island', QC: 'Quebec', SK: 'Saskatchewan',
};

@Injectable()
export class CopartService {
  constructor(
    private prisma: PrismaService,
    private titleMapping: TitleMappingService,
  ) {}

  async findAll(query: QueryCopartDto) {
    const {
      page = 1,
      limit = 20,
      search,
      make,
      model,
      year,
      yearMin,
      yearMax,
      damageDescription,
      saleStatus,
      locationState,
      minPrice,
      maxPrice,
      minOdometer,
      maxOdometer,
      hasKeys,
      runsDrives,
      runsAndDrives,
      saleTitleType,
      titleCategory,
      sellerCategory,
      color,
      cylinders,
      drive,
      bodyStyle,
      fuelType,
      transmission,
      engineSizeMin,
      engineSizeMax,
      zip,
      radius,
      trim,
      saleDateFrom,
      saleDateTo,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      ids,
      inspectableOnly,
    } = query;

    const skip = (page - 1) * limit;

    // Parse IDs filter (comma-separated string)
    const idList = ids ? ids.split(',').filter((id) => id.trim()) : null;

    // ZIP radius → bounding box on locationLat/Lng (cheap, index-friendly).
    // Exact-circle refinement is unnecessary at the radii the UI offers.
    let geoBox: Prisma.AuctionListingWhereInput = {};
    if (zip && radius && radius > 0) {
      const center = geocodeZip(zip);
      if (center) {
        const box = boundingBox(center, radius);
        geoBox = {
          locationLat: { gte: box.minLat, lte: box.maxLat },
          locationLng: { gte: box.minLon, lte: box.maxLon },
        };
      }
    }

    // titleCategory → where clause. Known cats → raw codes (base + learned
    // overrides); "unknown" → codes NOT in the known set. Multiple cats OR.
    const titleOverrides = await this.titleMapping.getOverrides();
    let titleCategoryClause: Prisma.AuctionListingWhereInput = {};
    if (titleCategory) {
      const cats = csv(titleCategory);
      const known = cats.filter((c) => c !== 'unknown');
      const wantUnknown = cats.includes('unknown');
      const or: Prisma.AuctionListingWhereInput[] = [];
      if (known.length > 0) {
        const codes = codesForTitleCategories(known, titleOverrides);
        if (codes.length > 0) or.push({ saleTitleType: { in: codes, mode: 'insensitive' } });
      }
      if (wantUnknown) {
        or.push({
          NOT: { saleTitleType: { in: allKnownCodes(titleOverrides), mode: 'insensitive' } },
        });
      }
      if (or.length === 1) titleCategoryClause = or[0];
      else if (or.length > 1) titleCategoryClause = { OR: or };
    }

    // Build where clause
    const where: Prisma.AuctionListingWhereInput = {
      AND: [
        // IDs filter (for favorites)
        idList && idList.length > 0 ? { lotNumber: { in: idList.map((id) => BigInt(id.trim())) } } : {},
        // Search across VIN, make, model
        search
          ? {
              OR: [
                { vin: { contains: search, mode: 'insensitive' } },
                { make: { contains: search, mode: 'insensitive' } },
                { modelGroup: { contains: search, mode: 'insensitive' } },
                { modelDetail: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {},

        // Make filter — comma-separated = multi-select (exact IN); single = insensitive equals
        make
          ? make.includes(',')
            ? { make: { in: csv(make) } }
            : { make: { equals: make, mode: 'insensitive' } }
          : {},

        // Model filter — comma-separated = multi-select on modelGroup (exact IN);
        // single value keeps the broad contains match on modelGroup/modelDetail
        model
          ? model.includes(',')
            ? { modelGroup: { in: csv(model) } }
            : {
                OR: [
                  { modelGroup: { contains: model, mode: 'insensitive' } },
                  { modelDetail: { contains: model, mode: 'insensitive' } },
                ],
              }
          : {},

        // Year filter — exact, or min/max range
        year
          ? { year }
          : yearMin || yearMax
            ? {
                year: {
                  ...(yearMin && { gte: yearMin }),
                  ...(yearMax && { lte: yearMax }),
                },
              }
            : {},

        // Damage filter — comma-separated = multi (exact IN); single = contains
        damageDescription
          ? damageDescription.includes(',')
            ? { damageDescription: { in: csv(damageDescription) } }
            : { damageDescription: { contains: damageDescription, mode: 'insensitive' } }
          : {},

        // Sale status filter — comma-separated = multi (exact IN); single = contains
        saleStatus
          ? saleStatus.includes(',')
            ? { saleStatus: { in: csv(saleStatus) } }
            : { saleStatus: { contains: saleStatus, mode: 'insensitive' } }
          : {},

        // Location state filter — comma-separated = multi (exact IN); single = equals
        locationState
          ? locationState.includes(',')
            ? { locationState: { in: csv(locationState) } }
            : { locationState: { equals: locationState, mode: 'insensitive' } }
          : {},

        // Price range (using estRetailValue)
        minPrice || maxPrice
          ? {
              estRetailValue: {
                ...(minPrice && { gte: minPrice }),
                ...(maxPrice && { lte: maxPrice }),
              },
            }
          : {},

        // Odometer range
        minOdometer || maxOdometer
          ? {
              odometer: {
                ...(minOdometer && { gte: minOdometer }),
                ...(maxOdometer && { lte: maxOdometer }),
              },
            }
          : {},

        // Has keys filter
        hasKeys ? { hasKeys } : {},

        // Runs/Drives free-text filter
        runsDrives
          ? { runsDrives: { contains: runsDrives, mode: 'insensitive' } }
          : {},

        // runsAndDrives boolean filter — matches "Run and Drive" / "Run & Drive",
        // excludes "Does Not Run". Uses two AND-clauses so both conditions hold.
        runsAndDrives === true
          ? { runsDrives: { contains: 'drive', mode: 'insensitive' } }
          : {},
        runsAndDrives === true
          ? { NOT: { runsDrives: { contains: 'not', mode: 'insensitive' } } }
          : {},

        // Title type filter (raw)
        saleTitleType
          ? { saleTitleType: { equals: saleTitleType, mode: 'insensitive' } }
          : {},

        // Primary title category (clean / nonrepairable / salvage / unknown)
        titleCategoryClause,

        // Source / seller category (multi)
        sellerCategory ? { sellerCategory: { in: csv(sellerCategory) } } : {},

        // Color (multi)
        color ? { color: { in: csv(color), mode: 'insensitive' } } : {},

        // Cylinders (multi)
        cylinders ? { cylinders: { in: csv(cylinders) } } : {},

        // Drivetrain (multi)
        drive ? { drive: { in: csv(drive), mode: 'insensitive' } } : {},

        // Body style (multi)
        bodyStyle ? { bodyStyle: { in: csv(bodyStyle), mode: 'insensitive' } } : {},

        // Fuel type (multi)
        fuelType ? { fuelType: { in: csv(fuelType), mode: 'insensitive' } } : {},

        // Transmission (multi)
        transmission ? { transmission: { in: csv(transmission), mode: 'insensitive' } } : {},

        // Engine size range (litres)
        engineSizeMin || engineSizeMax
          ? {
              engineSizeL: {
                ...(engineSizeMin && { gte: engineSizeMin }),
                ...(engineSizeMax && { lte: engineSizeMax }),
              },
            }
          : {},

        // ZIP radius bounding box
        geoBox,

        // Trim filter (cascades from model) — comma-separated = multi-select
        trim
          ? trim.includes(',')
            ? { trim: { in: csv(trim) } }
            : { trim: { equals: trim, mode: 'insensitive' } }
          : {},

        // Sale date range filter (saleDate is stored as YYYYMMDD integer)
        saleDateFrom || saleDateTo
          ? {
              saleDate: {
                ...(saleDateFrom && { gte: saleDateFrom }),
                ...(saleDateTo && { lte: saleDateTo }),
              },
            }
          : {},

        // Inspectable filter — only listings whose yard offers on-site inspection
        inspectableOnly === true
          ? { yard: { is: { physicalInspectionAvailable: true } } }
          : {},
      ],
    };

    // Build orderBy
    const orderBy: Prisma.AuctionListingOrderByWithRelationInput = {};
    const validSortFields = [
      'createdAt',
      'year',
      'make',
      'estRetailValue',
      'odometer',
      'saleDate',
      'highBid',
    ];
    if (validSortFields.includes(sortBy)) {
      orderBy[sortBy] = sortOrder;
    } else {
      orderBy.createdAt = 'desc';
    }

    // Execute queries in parallel
    const [listings, total] = await Promise.all([
      this.prisma.auctionListing.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          yard: { select: { physicalInspectionAvailable: true } },
        },
      }),
      this.prisma.auctionListing.count({ where }),
    ]);

    // Convert BigInt to string for JSON serialization and surface a flat
    // `inspectable` flag derived from the yard's on-site inspection availability.
    const serializedListings = listings.map(({ yard, ...listing }) => ({
      ...listing,
      lotNumber: listing.lotNumber.toString(),
      inspectable: yard?.physicalInspectionAvailable ?? false,
    }));

    return {
      data: serializedListings,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPreviousPage: page > 1,
      },
    };
  }

  async findOne(id: string) {
    const listing = await this.prisma.auctionListing.findUnique({
      where: { lotNumber: BigInt(id) },
      include: { yard: { select: { physicalInspectionAvailable: true } } },
    });

    if (!listing) {
      return null;
    }

    const { yard, ...rest } = listing;
    return {
      ...rest,
      lotNumber: listing.lotNumber.toString(),
      inspectable: yard?.physicalInspectionAvailable ?? false,
    };
  }

  async findByLotNumber(lotNumber: string) {
    const listing = await this.prisma.auctionListing.findUnique({
      where: { lotNumber: BigInt(lotNumber) },
      include: { yard: { select: { physicalInspectionAvailable: true } } },
    });

    if (!listing) {
      return null;
    }

    const { yard, ...rest } = listing;
    return {
      ...rest,
      lotNumber: listing.lotNumber.toString(),
      inspectable: yard?.physicalInspectionAvailable ?? false,
    };
  }

  async getFilterOptions() {
    // Get distinct values for filters
    const [makes, damageTypes, saleStatuses, states, years, titleTypes] = await Promise.all([
      this.prisma.$queryRaw<{ make: string }[]>`
        SELECT DISTINCT make FROM auction_listings WHERE make IS NOT NULL ORDER BY make
      `,
      this.prisma.$queryRaw<{ damageDescription: string }[]>`
        SELECT DISTINCT "damageDescription" FROM auction_listings WHERE "damageDescription" IS NOT NULL ORDER BY "damageDescription"
      `,
      this.prisma.$queryRaw<{ saleStatus: string }[]>`
        SELECT DISTINCT "saleStatus" FROM auction_listings WHERE "saleStatus" IS NOT NULL ORDER BY "saleStatus"
      `,
      this.prisma.$queryRaw<{ locationState: string }[]>`
        SELECT DISTINCT "locationState" FROM auction_listings WHERE "locationState" IS NOT NULL ORDER BY "locationState"
      `,
      this.prisma.$queryRaw<{ year: number }[]>`
        SELECT DISTINCT year FROM auction_listings WHERE year IS NOT NULL ORDER BY year DESC
      `,
      this.prisma.$queryRaw<{ saleTitleType: string }[]>`
        SELECT DISTINCT "saleTitleType" FROM auction_listings WHERE "saleTitleType" IS NOT NULL ORDER BY "saleTitleType"
      `,
    ]);

    return {
      makes: makes.map((m) => m.make),
      damageTypes: damageTypes.map((d) => d.damageDescription),
      saleStatuses: saleStatuses.map((s) => s.saleStatus),
      states: states.map((s) => s.locationState),
      years: years.map((y) => y.year),
      titleTypes: titleTypes.map((t) => t.saleTitleType),
    };
  }

  /**
   * Faceted, cascading filter options for the customer portal.
   * Cascades year → make → model → trim. Non-vehicle facets (damage, saleStatus,
   * titleType, state, hasKeys) are always scoped to the current vehicle selection.
   * Runs all queries in parallel; skips models/trims when their prerequisite is absent.
   */
  async getPortalFilters(opts: {
    year?: number;
    make?: string;
    model?: string;
    trim?: string;
  }): Promise<PortalFiltersResult> {
    const { year, make, model, trim } = opts;

    // ── Vehicle selection where clauses ────────────────────────────────────────
    // make/model/trim may be comma-separated (multi-select) → IN; single → equals.
    const yearClause = year ? { year } : undefined;
    const makeClause = make
      ? make.includes(',')
        ? { make: { in: csv(make) } }
        : { make: { equals: make, mode: 'insensitive' as const } }
      : undefined;
    const modelClause = model
      ? model.includes(',')
        ? { modelGroup: { in: csv(model) } }
        : { modelGroup: { equals: model, mode: 'insensitive' as const } }
      : undefined;
    const trimClause = trim
      ? trim.includes(',')
        ? { trim: { in: csv(trim) } }
        : { trim: { equals: trim, mode: 'insensitive' as const } }
      : undefined;

    // The web only surfaces vehicles in yards that offer physical inspection, so
    // every facet count must be scoped to inspectable inventory too.
    const inspectable: Prisma.AuctionListingWhereInput = {
      yard: { is: { physicalInspectionAvailable: true } },
    };

    // vehicleSel = all provided opts combined (used by the 5 non-vehicle facets)
    const vehicleSel: Prisma.AuctionListingWhereInput = {
      ...inspectable,
      ...(yearClause ?? {}),
      ...(makeClause ?? {}),
      ...(modelClause ?? {}),
      ...(trimClause ?? {}),
    };

    // ── Run all feasible facet queries in parallel ─────────────────────────────
    const [
      yearsRaw,
      makesRaw,
      modelsRaw,
      trimsRaw,
      damageRaw,
      statusRaw,
      titleRaw,
      stateRaw,
      keysRaw,
      sourceRaw,
      colorRaw,
      cylinderRaw,
      driveRaw,
      bodyRaw,
      fuelRaw,
      transRaw,
    ] = await Promise.all([
      // years — no vehicle filter; order desc
      this.prisma.auctionListing.groupBy({
        by: ['year'],
        where: { ...inspectable, year: { not: null } },
        _count: { _all: true },
        orderBy: { year: 'desc' },
      }),

      // makes — filtered by year only
      this.prisma.auctionListing.groupBy({
        by: ['make'],
        where: { ...inspectable, ...(yearClause ?? {}), make: { not: null } },
        _count: { _all: true },
        orderBy: { make: 'asc' },
      }),

      // models — only when make is set
      make
        ? this.prisma.auctionListing.groupBy({
            by: ['modelGroup'],
            where: {
              ...inspectable,
              ...(yearClause ?? {}),
              ...(makeClause ?? {}),
              modelGroup: { not: null },
            },
            _count: { _all: true },
            orderBy: { modelGroup: 'asc' },
          })
        : Promise.resolve([]),

      // trims — only when make + model are set
      make && model
        ? this.prisma.auctionListing.groupBy({
            by: ['trim'],
            where: {
              ...inspectable,
              ...(yearClause ?? {}),
              ...(makeClause ?? {}),
              ...(modelClause ?? {}),
              trim: { not: null },
            },
            _count: { _all: true },
            orderBy: { trim: 'asc' },
          })
        : Promise.resolve([]),

      // damageTypes — scoped to vehicleSel
      this.prisma.auctionListing.groupBy({
        by: ['damageDescription'],
        where: { ...vehicleSel, damageDescription: { not: null } },
        _count: { _all: true },
        orderBy: { damageDescription: 'asc' },
      }),

      // saleStatuses — scoped to vehicleSel
      this.prisma.auctionListing.groupBy({
        by: ['saleStatus'],
        where: { ...vehicleSel, saleStatus: { not: null } },
        _count: { _all: true },
        orderBy: { saleStatus: 'asc' },
      }),

      // titleTypes — scoped to vehicleSel
      this.prisma.auctionListing.groupBy({
        by: ['saleTitleType'],
        where: { ...vehicleSel, saleTitleType: { not: null } },
        _count: { _all: true },
        orderBy: { saleTitleType: 'asc' },
      }),

      // states — scoped to vehicleSel; junk rows dropped via STATE_MAP
      this.prisma.auctionListing.groupBy({
        by: ['locationState'],
        where: { ...vehicleSel, locationState: { not: null } },
        _count: { _all: true },
        orderBy: { locationState: 'asc' },
      }),

      // hasKeys — scoped to vehicleSel
      this.prisma.auctionListing.groupBy({
        by: ['hasKeys'],
        where: { ...vehicleSel, hasKeys: { not: null } },
        _count: { _all: true },
        orderBy: { hasKeys: 'asc' },
      }),

      // sellerCategory (Source) — scoped to vehicleSel
      this.prisma.auctionListing.groupBy({
        by: ['sellerCategory'],
        where: { ...vehicleSel, sellerCategory: { not: null } },
        _count: { _all: true },
        orderBy: { sellerCategory: 'asc' },
      }),

      // colors — scoped to vehicleSel
      this.prisma.auctionListing.groupBy({
        by: ['color'],
        where: { ...vehicleSel, color: { not: null } },
        _count: { _all: true },
        orderBy: { color: 'asc' },
      }),

      // cylinders — scoped to vehicleSel
      this.prisma.auctionListing.groupBy({
        by: ['cylinders'],
        where: { ...vehicleSel, cylinders: { not: null } },
        _count: { _all: true },
        orderBy: { cylinders: 'asc' },
      }),

      // drivetrain — scoped to vehicleSel
      this.prisma.auctionListing.groupBy({
        by: ['drive'],
        where: { ...vehicleSel, drive: { not: null } },
        _count: { _all: true },
        orderBy: { drive: 'asc' },
      }),

      // body styles — scoped to vehicleSel
      this.prisma.auctionListing.groupBy({
        by: ['bodyStyle'],
        where: { ...vehicleSel, bodyStyle: { not: null } },
        _count: { _all: true },
        orderBy: { bodyStyle: 'asc' },
      }),

      // fuel types — scoped to vehicleSel
      this.prisma.auctionListing.groupBy({
        by: ['fuelType'],
        where: { ...vehicleSel, fuelType: { not: null } },
        _count: { _all: true },
        orderBy: { fuelType: 'asc' },
      }),

      // transmissions — scoped to vehicleSel
      this.prisma.auctionListing.groupBy({
        by: ['transmission'],
        where: { ...vehicleSel, transmission: { not: null } },
        _count: { _all: true },
        orderBy: { transmission: 'asc' },
      }),
    ]);

    // ── Map raw groupBy results to Facet shapes ────────────────────────────────

    const years: FacetNum[] = yearsRaw
      .filter((r) => r.year !== null)
      .map((r) => ({
        value: r.year as number,
        label: String(r.year),
        count: r._count._all,
      }));

    const makes: Facet[] = makesRaw
      .filter((r) => r.make !== null && r.make !== '')
      .map((r) => ({
        value: r.make as string,
        label: titleCase(r.make as string),
        count: r._count._all,
      }));

    const models: Facet[] = (modelsRaw as Array<{ modelGroup: string | null; _count: { _all: number } }>)
      .filter((r) => r.modelGroup !== null && r.modelGroup !== '')
      .map((r) => ({
        value: r.modelGroup as string,
        label: titleCase(r.modelGroup as string),
        count: r._count._all,
      }));

    const trims: Facet[] = (trimsRaw as Array<{ trim: string | null; _count: { _all: number } }>)
      .filter((r) => r.trim !== null && r.trim !== '')
      .map((r) => ({
        value: r.trim as string,
        label: titleCase(r.trim as string),
        count: r._count._all,
      }));

    const damageTypes: Facet[] = (damageRaw as Array<{ damageDescription: string | null; _count: { _all: number } }>)
      .filter((r) => r.damageDescription !== null && r.damageDescription !== '')
      .map((r) => ({
        value: r.damageDescription as string,
        label: titleCase(r.damageDescription as string),
        count: r._count._all,
      }));

    const saleStatuses: Facet[] = (statusRaw as Array<{ saleStatus: string | null; _count: { _all: number } }>)
      .filter((r) => r.saleStatus !== null && r.saleStatus !== '')
      .map((r) => ({
        value: r.saleStatus as string,
        label: titleCase(r.saleStatus as string),
        count: r._count._all,
      }));

    const titleTypes: Facet[] = (titleRaw as Array<{ saleTitleType: string | null; _count: { _all: number } }>)
      .filter((r) => r.saleTitleType !== null && r.saleTitleType !== '')
      .map((r) => ({
        value: r.saleTitleType as string,
        label: titleTypeLabel(r.saleTitleType as string),
        count: r._count._all,
      }));

    const states: Facet[] = (stateRaw as Array<{ locationState: string | null; _count: { _all: number } }>)
      .filter((r) => {
        if (!r.locationState || r.locationState === '') return false;
        const key = r.locationState.trim().toUpperCase();
        return key in STATE_MAP;
      })
      .map((r) => {
        const key = (r.locationState as string).trim().toUpperCase();
        return {
          value: key,
          label: STATE_MAP[key],
          count: r._count._all,
        };
      })
      // Sort by full state name
      .sort((a, b) => a.label.localeCompare(b.label));

    const keys: Facet[] = (keysRaw as Array<{ hasKeys: string | null; _count: { _all: number } }>)
      .filter((r) => r.hasKeys !== null && r.hasKeys !== '')
      .map((r) => ({
        value: r.hasKeys as string,
        label: r.hasKeys as string,
        count: r._count._all,
      }));

    // Roll the raw title-type buckets up into the primary categories (incl.
    // unknown), honouring the learned staff overrides.
    const titleOverrides = await this.titleMapping.getOverrides();
    const categoryCounts = Object.fromEntries(
      TITLE_CATEGORIES.map((cat) => [cat, 0]),
    ) as Record<TitleCategory, number>;
    for (const r of titleRaw as Array<{ saleTitleType: string | null; _count: { _all: number } }>) {
      if (!r.saleTitleType) continue;
      categoryCounts[deriveTitleCategory(r.saleTitleType, titleOverrides)] += r._count._all;
    }
    const titleCategories: Facet[] = TITLE_CATEGORIES.map((cat) => ({
      value: cat,
      label: TITLE_CATEGORY_LABELS[cat],
      count: categoryCounts[cat],
    })).filter((f) => f.count > 0);

    const mapSimpleFacet = (
      rows: Array<Record<string, unknown>>,
      key: string,
    ): Facet[] =>
      rows
        .filter((r) => r[key] !== null && r[key] !== '')
        .map((r) => ({
          value: String(r[key]),
          label: titleCase(String(r[key])),
          count: (r._count as { _all: number })._all,
        }));

    const sources: Facet[] = mapSimpleFacet(sourceRaw as Array<Record<string, unknown>>, 'sellerCategory')
      // Source labels are already canonical (Insurance/Rental/Repo/Other)
      .map((f) => ({ ...f, label: f.value }));
    const colors: Facet[] = mapSimpleFacet(colorRaw as Array<Record<string, unknown>>, 'color');
    const cylinders: Facet[] = (cylinderRaw as Array<{ cylinders: string | null; _count: { _all: number } }>)
      .filter((r) => r.cylinders !== null && r.cylinders !== '')
      .map((r) => ({ value: r.cylinders as string, label: r.cylinders as string, count: r._count._all }));
    const drivetrains: Facet[] = mapSimpleFacet(driveRaw as Array<Record<string, unknown>>, 'drive');
    const bodyStyles: Facet[] = mapSimpleFacet(bodyRaw as Array<Record<string, unknown>>, 'bodyStyle');
    const fuelTypes: Facet[] = mapSimpleFacet(fuelRaw as Array<Record<string, unknown>>, 'fuelType');
    const transmissions: Facet[] = mapSimpleFacet(transRaw as Array<Record<string, unknown>>, 'transmission');

    return {
      years,
      makes,
      models,
      trims,
      damageTypes,
      saleStatuses,
      titleTypes,
      titleCategories,
      sources,
      colors,
      cylinders,
      drivetrains,
      bodyStyles,
      fuelTypes,
      transmissions,
      states,
      keys,
    };
  }

  async getStats() {
    const [total, byDamage, byState] = await Promise.all([
      this.prisma.auctionListing.count(),
      this.prisma.auctionListing.groupBy({
        by: ['damageDescription'],
        _count: true,
        orderBy: { _count: { damageDescription: 'desc' } },
        take: 10,
      }),
      this.prisma.auctionListing.groupBy({
        by: ['locationState'],
        _count: true,
        orderBy: { _count: { locationState: 'desc' } },
        take: 10,
      }),
    ]);

    return {
      total,
      byDamage,
      byState,
    };
  }
}
