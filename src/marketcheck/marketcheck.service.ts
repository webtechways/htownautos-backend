import { Injectable, Logger, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { QueryScaAuctionDto } from './dto/query-sca-auction.dto';
import { Prisma } from '@prisma/client';

interface MarketCheckTermsResponse {
  [field: string]: string[];
}

interface MarketCheckPriceResponse {
  marketcheck_price?: number;
  msrp?: number;
}

export interface VinDecodeResult {
  vin: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  bodyType: string | null;
  transmission: string | null;
  drivetrain: string | null;
  fuelType: string | null;
  engine: string | null;
  cylinders: number | null;
  doors: number | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  vehicleType: string | null;
}


interface MarketCheckSearchResponse {
  num_found: number;
  listings: MarketCheckListing[];
}

export interface MarketCheckListing {
  id: string;
  vin: string;
  heading: string;
  price: number | null;
  miles: number | null;
  msrp: number | null;
  exterior_color: string | null;
  interior_color: string | null;
  dom: number | null;
  dom_active: number | null;
  seller_type: string | null;
  inventory_type: string | null;
  stock_no: string | null;
  carfax_1_owner: boolean | null;
  carfax_clean_title: boolean | null;
  first_seen_at_date: string | null;
  last_seen_at_date: string | null;
  vdp_url: string | null;
  source: string | null;
  media?: {
    photo_links?: string[];
  };
  dealer?: {
    name: string;
    city: string;
    state: string;
    zip: string;
    dealer_type: string;
    phone: string | null;
    street: string | null;
  };
  build?: {
    year: number;
    make: string;
    model: string;
    trim: string;
    body_type: string | null;
    transmission: string | null;
    drivetrain: string | null;
    fuel_type: string | null;
    engine: string | null;
    doors: number | null;
    cylinders: number | null;
    highway_mpg: number | null;
    city_mpg: number | null;
  };
  dist: number | null;
}

export interface MarketCheckCompsResult {
  listings: MarketCheckListing[];
  numFound: number;
  cached: boolean;
}

export interface MarketCheckPriceResult {
  marketcheckPrice: number | null;
  msrp: number | null;
  cached: boolean;
  zip: string;
}

export interface AuctionListing {
  id: string;
  vin: string;
  heading: string;
  price: number | null;
  miles: number | null;
  exterior_color: string | null;
  interior_color: string | null;
  source: string | null;
  vdp_url: string | null;
  seller_name: string | null;
  auction_date: string | null;
  media?: {
    photo_links?: string[];
  };
  build?: {
    year: number;
    make: string;
    model: string;
    trim: string;
    body_type: string | null;
    transmission: string | null;
    drivetrain: string | null;
    fuel_type: string | null;
    engine: string | null;
  };
}

export interface AuctionSearchFilters {
  make?: string;
  model?: string;
  year?: string;
  year_range?: string;
  body_type?: string;
  transmission?: string;
  fuel_type?: string;
  drivetrain?: string;
  price_range?: string;
  odometer_range?: string;
  state?: string;
  source?: string;
  sort_by?: string;
  sort_order?: string;
  rows?: number;
  start?: number;
}

export interface AuctionSearchResult {
  listings: AuctionListing[];
  numFound: number;
  cached: boolean;
}

@Injectable()
export class MarketCheckService {
  private readonly logger = new Logger(MarketCheckService.name);
  private readonly baseUrl = 'https://api.marketcheck.com/v2/specs/car/terms';
  private readonly priceUrl = 'https://api.marketcheck.com/v2/predict/car/us/marketcheck_price';
  private readonly searchUrl = 'https://api.marketcheck.com/v2/search/car/active';
  private readonly auctionUrl = 'https://api.marketcheck.com/v2/search/car/auction';
  private readonly decodeUrl = 'https://api.marketcheck.com/v2/decode/car';
  private readonly apiKey: string;
  private readonly CACHE_TTL_HOURS = 24;
  private readonly AUCTION_CACHE_TTL_HOURS = 6;

  constructor(private readonly prisma: PrismaService) {
    this.apiKey = process.env.MARKETCHECK_API_KEY || '';
    if (!this.apiKey) {
      this.logger.warn('MARKETCHECK_API_KEY is not set');
    }
  }

  private readonly pageSize = 1000;

  private async fetchTermsPage(
    field: string,
    offset: number,
    filters: Record<string, string> = {},
  ): Promise<string[]> {
    const params = new URLSearchParams({
      api_key: this.apiKey,
      field: `${field}|${offset}|${this.pageSize}`,
      ...filters,
    });

    const url = `${this.baseUrl}?${params.toString()}`;
    const safeUrl = url.replace(/api_key=[^&]+/, 'api_key=***');

    this.logger.log(`→ MarketCheck API GET ${safeUrl}`);
    const start = Date.now();

    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
      });

      const duration = Date.now() - start;

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `← MarketCheck API ${response.status} ${response.statusText} (${duration}ms) ${safeUrl}`,
        );
        this.logger.error(`← MarketCheck API Error Body: ${errorBody}`);
        throw new InternalServerErrorException('Failed to fetch data from MarketCheck');
      }

      const data: MarketCheckTermsResponse = await response.json();
      const results = data[field] || [];
      this.logger.log(`← MarketCheck API 200 OK (${duration}ms) field=${field} offset=${offset} results=${results.length}`);
      return results;
    } catch (error) {
      const duration = Date.now() - start;
      if (error instanceof InternalServerErrorException) throw error;
      this.logger.error(`← MarketCheck API FAILED (${duration}ms): ${error}`);
      throw new InternalServerErrorException('Failed to fetch data from MarketCheck');
    }
  }

  private async fetchTerms(
    field: string,
    filters: Record<string, string> = {},
  ): Promise<string[]> {
    const allResults: string[] = [];
    let offset = 0;

    while (true) {
      const page = await this.fetchTermsPage(field, offset, filters);
      allResults.push(...page);

      if (page.length < this.pageSize) {
        break;
      }
      offset += this.pageSize;
    }

    this.logger.log(`MarketCheck total for field=${field}: ${allResults.length} results (${Math.ceil(offset / this.pageSize) + 1} pages)`);
    return allResults;
  }

  async getMakes(year: string): Promise<string[]> {
    return this.fetchTerms('make', { year });
  }

  async getModels(year: string, make: string): Promise<string[]> {
    return this.fetchTerms('model', { year, make });
  }

  async getTrims(year: string, make: string, model: string): Promise<string[]> {
    return this.fetchTerms('trim', { year, make, model });
  }

  /**
   * Decode a VIN to get vehicle specifications
   * Uses MarketCheck API: https://api.marketcheck.com/v2/decode/car/{vin}/specs
   */
  async decodeVin(vin: string): Promise<VinDecodeResult> {
    if (!vin || vin.length !== 17) {
      throw new BadRequestException('VIN must be exactly 17 characters');
    }

    const url = `${this.decodeUrl}/${vin}/specs?api_key=${this.apiKey}`;
    const safeUrl = url.replace(/api_key=[^&]+/, 'api_key=***');

    this.logger.log(`→ MarketCheck Decode API GET ${safeUrl}`);
    const start = Date.now();

    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
      });

      const duration = Date.now() - start;

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `← MarketCheck Decode API ${response.status} ${response.statusText} (${duration}ms)`,
        );
        this.logger.error(`← MarketCheck Decode API Error Body: ${errorBody}`);

        if (response.status === 404) {
          throw new BadRequestException('VIN not found or invalid');
        }
        throw new InternalServerErrorException('Failed to decode VIN from MarketCheck');
      }

      const data = await response.json();
      this.logger.log(`← MarketCheck Decode API 200 OK (${duration}ms) year=${data.year} make=${data.make} model=${data.model}`);

      return {
        vin: vin.toUpperCase(),
        year: data.year ?? null,
        make: data.make ?? null,
        model: data.model ?? null,
        trim: data.trim ?? null,
        bodyType: data.body_type ?? null,
        transmission: data.transmission ?? null,
        drivetrain: data.drivetrain ?? null,
        fuelType: data.fuel_type ?? null,
        engine: data.engine ?? null,
        cylinders: data.cylinders ?? null,
        doors: data.doors ?? null,
        exteriorColor: data.exterior_color ?? null,
        interiorColor: data.interior_color ?? null,
        vehicleType: data.vehicle_type ?? null,
      };
    } catch (error) {
      const duration = Date.now() - start;
      if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
        throw error;
      }
      this.logger.error(`← MarketCheck Decode API FAILED (${duration}ms): ${error}`);
      throw new InternalServerErrorException('Failed to decode VIN from MarketCheck');
    }
  }

  async getPredictedPrice(
    vin: string,
    miles: number,
    dealerType: string,
    zip: string,
  ): Promise<MarketCheckPriceResult> {
    // Check cache first
    const cached = await this.prisma.marketCheckPriceCache.findUnique({
      where: {
        vin_miles_dealerType_zip: { vin, miles, dealerType, zip },
      },
    });

    if (cached && cached.expiresAt > new Date()) {
      this.logger.log(`Cache HIT for VIN=${vin} zip=${zip}`);
      return {
        marketcheckPrice: cached.marketcheckPrice ? Number(cached.marketcheckPrice) : null,
        msrp: cached.msrp ? Number(cached.msrp) : null,
        cached: true,
        zip,
      };
    }

    // If expired, delete it
    if (cached) {
      await this.prisma.marketCheckPriceCache.delete({
        where: { id: cached.id },
      });
    }

    // Validate miles > 0
    if (!miles || miles <= 0) {
      throw new BadRequestException('Mileage must be greater than 0 to get market price');
    }

    // Fetch from MarketCheck API
    const params = new URLSearchParams({
      api_key: this.apiKey,
      vin,
      miles: miles.toString(),
      dealer_type: dealerType,
      zip,
    });

    const url = `${this.priceUrl}?${params.toString()}`;
    const safeUrl = url.replace(/api_key=[^&]+/, 'api_key=***');

    this.logger.log(`→ MarketCheck Price API GET ${safeUrl}`);
    const start = Date.now();

    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
      });

      const duration = Date.now() - start;

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `← MarketCheck Price API ${response.status} ${response.statusText} (${duration}ms)`,
        );
        this.logger.error(`← MarketCheck Price API Error Body: ${errorBody}`);
        throw new InternalServerErrorException('Failed to fetch price from MarketCheck');
      }

      const data: MarketCheckPriceResponse = await response.json();
      this.logger.log(`← MarketCheck Price API 200 OK (${duration}ms) price=${data.marketcheck_price} msrp=${data.msrp}`);

      // Store in cache
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + this.CACHE_TTL_HOURS);

      await this.prisma.marketCheckPriceCache.create({
        data: {
          vin,
          miles,
          dealerType,
          zip,
          marketcheckPrice: data.marketcheck_price ?? null,
          msrp: data.msrp ?? null,
          rawResponse: data as any,
          expiresAt,
        },
      });

      return {
        marketcheckPrice: data.marketcheck_price ?? null,
        msrp: data.msrp ?? null,
        cached: false,
        zip,
      };
    } catch (error) {
      const duration = Date.now() - start;
      if (error instanceof InternalServerErrorException) throw error;
      this.logger.error(`← MarketCheck Price API FAILED (${duration}ms): ${error}`);
      throw new InternalServerErrorException('Failed to fetch price from MarketCheck');
    }
  }

  async getComparables(
    make: string,
    model: string,
    year: number,
    zip: string,
  ): Promise<MarketCheckCompsResult> {
    // Check cache first
    const cached = await this.prisma.marketCheckCompsCache.findUnique({
      where: {
        make_model_year_zip: { make, model, year, zip },
      },
    });

    if (cached && cached.expiresAt > new Date()) {
      this.logger.log(`Comps Cache HIT for ${year} ${make} ${model} zip=${zip}`);
      return {
        listings: cached.listings as unknown as MarketCheckListing[],
        numFound: cached.numFound,
        cached: true,
      };
    }

    // If expired, delete it
    if (cached) {
      await this.prisma.marketCheckCompsCache.delete({
        where: { id: cached.id },
      });
    }

    // Fetch from MarketCheck API (get more rows to filter locally)
    const params = new URLSearchParams({
      api_key: this.apiKey,
      zip,
      make,
      model,
      year: year.toString(),
      rows: '100',
      radius: '100',
      sort_by: 'dom',
      sort_order: 'asc',
    });

    const url = `${this.searchUrl}?${params.toString()}`;
    const safeUrl = url.replace(/api_key=[^&]+/, 'api_key=***');

    this.logger.log(`→ MarketCheck Search API GET ${safeUrl}`);
    const start = Date.now();

    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
      });

      const duration = Date.now() - start;

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `← MarketCheck Search API ${response.status} ${response.statusText} (${duration}ms)`,
        );
        this.logger.error(`← MarketCheck Search API Error Body: ${errorBody}`);
        throw new InternalServerErrorException('Failed to fetch comparables from MarketCheck');
      }

      const data: MarketCheckSearchResponse = await response.json();
      this.logger.log(`← MarketCheck Search API 200 OK (${duration}ms) num_found=${data.num_found} listings=${data.listings?.length || 0}`);

      const listings: MarketCheckListing[] = (data.listings || []).map((l: any) => ({
        id: l.id,
        vin: l.vin,
        heading: l.heading,
        price: l.price ?? null,
        miles: l.miles ?? null,
        msrp: l.msrp ?? null,
        exterior_color: l.exterior_color ?? null,
        interior_color: l.interior_color ?? null,
        dom: l.dom ?? null,
        dom_active: l.dom_active ?? null,
        seller_type: l.seller_type ?? null,
        inventory_type: l.inventory_type ?? null,
        stock_no: l.stock_no ?? null,
        carfax_1_owner: l.carfax_1_owner ?? null,
        carfax_clean_title: l.carfax_clean_title ?? null,
        first_seen_at_date: l.first_seen_at_date ?? null,
        last_seen_at_date: l.last_seen_at_date ?? null,
        vdp_url: l.vdp_url ?? null,
        source: l.source ?? null,
        media: l.media ? { photo_links: (l.media.photo_links || []).slice(0, 5) } : undefined,
        dealer: l.dealer ? {
          name: l.dealer.name,
          city: l.dealer.city,
          state: l.dealer.state,
          zip: l.dealer.zip ?? '',
          dealer_type: l.dealer.dealer_type,
          phone: l.dealer.phone ?? null,
          street: l.dealer.street ?? null,
        } : undefined,
        build: l.build ? {
          year: l.build.year,
          make: l.build.make,
          model: l.build.model,
          trim: l.build.trim,
          body_type: l.build.body_type ?? null,
          transmission: l.build.transmission ?? null,
          drivetrain: l.build.drivetrain ?? null,
          fuel_type: l.build.fuel_type ?? null,
          engine: l.build.engine ?? null,
          doors: l.build.doors ?? null,
          cylinders: l.build.cylinders ?? null,
          highway_mpg: l.build.highway_mpg ?? null,
          city_mpg: l.build.city_mpg ?? null,
        } : undefined,
        dist: l.dist ?? null,
      })).filter((l) => l.dom !== null && l.dom <= 90);

      // Store in cache
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + this.CACHE_TTL_HOURS);

      await this.prisma.marketCheckCompsCache.create({
        data: {
          make,
          model,
          year,
          zip,
          listings: listings as any,
          numFound: listings.length,
          expiresAt,
        },
      });

      return {
        listings,
        numFound: listings.length,
        cached: false,
      };
    } catch (error) {
      const duration = Date.now() - start;
      if (error instanceof InternalServerErrorException) throw error;
      this.logger.error(`← MarketCheck Search API FAILED (${duration}ms): ${error}`);
      throw new InternalServerErrorException('Failed to fetch comparables from MarketCheck');
    }
  }

  /**
   * Generate cache key for auction search
   */
  private generateAuctionCacheKey(filters: AuctionSearchFilters): string {
    const parts = [
      filters.make || '',
      filters.model || '',
      filters.year || '',
      filters.year_range || '',
      filters.body_type || '',
      filters.transmission || '',
      filters.fuel_type || '',
      filters.drivetrain || '',
      filters.price_range || '',
      filters.odometer_range || '',
      filters.state || '',
      filters.source || '',
      filters.sort_by || 'first_seen_at_date',
      filters.sort_order || 'desc',
      String(filters.rows || 50),
      String(filters.start || 0),
    ];
    return parts.join('|');
  }

  /**
   * Search active auction listings
   */
  async searchAuctions(filters: AuctionSearchFilters): Promise<AuctionSearchResult> {
    const cacheKey = this.generateAuctionCacheKey(filters);

    // Check cache first
    const cached = await this.prisma.marketCheckAuctionCache.findUnique({
      where: { cacheKey },
    });

    if (cached && cached.expiresAt > new Date()) {
      this.logger.log(`Auction Cache HIT for key=${cacheKey.substring(0, 50)}...`);
      return {
        listings: cached.listings as unknown as AuctionListing[],
        numFound: cached.numFound,
        cached: true,
      };
    }

    // If expired, delete it
    if (cached) {
      await this.prisma.marketCheckAuctionCache.delete({
        where: { id: cached.id },
      });
    }

    // Build query params
    const params = new URLSearchParams({
      api_key: this.apiKey,
      rows: String(filters.rows || 50),
      start: String(filters.start || 0),
      sort_by: filters.sort_by || 'first_seen_at_date',
      sort_order: filters.sort_order || 'desc',
    });

    if (filters.make) params.append('make', filters.make);
    if (filters.model) params.append('model', filters.model);
    if (filters.year) params.append('year', filters.year);
    if (filters.year_range) params.append('year_range', filters.year_range);
    if (filters.body_type) params.append('body_type', filters.body_type);
    if (filters.transmission) params.append('transmission', filters.transmission);
    if (filters.fuel_type) params.append('fuel_type', filters.fuel_type);
    if (filters.drivetrain) params.append('drivetrain', filters.drivetrain);
    if (filters.price_range) params.append('price_range', filters.price_range);
    if (filters.odometer_range) params.append('odometer_range', filters.odometer_range);
    if (filters.state) params.append('state', filters.state);
    if (filters.source) params.append('source', filters.source);

    const url = `${this.auctionUrl}?${params.toString()}`;
    const safeUrl = url.replace(/api_key=[^&]+/, 'api_key=***');

    this.logger.log(`→ MarketCheck Auction API GET ${safeUrl}`);
    const start = Date.now();

    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
      });

      const duration = Date.now() - start;

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `← MarketCheck Auction API ${response.status} ${response.statusText} (${duration}ms)`,
        );
        this.logger.error(`← MarketCheck Auction API Error Body: ${errorBody}`);
        throw new InternalServerErrorException('Failed to fetch auctions from MarketCheck');
      }

      const data = await response.json();
      this.logger.log(`← MarketCheck Auction API 200 OK (${duration}ms) num_found=${data.num_found} listings=${data.listings?.length || 0}`);

      const listings: AuctionListing[] = (data.listings || []).map((l: any) => ({
        id: l.id,
        vin: l.vin,
        heading: l.heading,
        price: l.price ?? null,
        miles: l.miles ?? null,
        exterior_color: l.exterior_color ?? null,
        interior_color: l.interior_color ?? null,
        source: l.source ?? null,
        vdp_url: l.vdp_url ?? null,
        seller_name: l.seller_name ?? l.dealer?.name ?? null,
        auction_date: l.auction_date ?? l.first_seen_at_date ?? null,
        media: l.media ? { photo_links: (l.media.photo_links || []).slice(0, 5) } : undefined,
        build: l.build ? {
          year: l.build.year,
          make: l.build.make,
          model: l.build.model,
          trim: l.build.trim ?? '',
          body_type: l.build.body_type ?? null,
          transmission: l.build.transmission ?? null,
          drivetrain: l.build.drivetrain ?? null,
          fuel_type: l.build.fuel_type ?? null,
          engine: l.build.engine ?? null,
        } : undefined,
      }));

      // Store in cache
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + this.AUCTION_CACHE_TTL_HOURS);

      await this.prisma.marketCheckAuctionCache.create({
        data: {
          cacheKey,
          listings: listings as any,
          numFound: data.num_found || listings.length,
          expiresAt,
        },
      });

      return {
        listings,
        numFound: data.num_found || listings.length,
        cached: false,
      };
    } catch (error) {
      const duration = Date.now() - start;
      if (error instanceof InternalServerErrorException) throw error;
      this.logger.error(`← MarketCheck Auction API FAILED (${duration}ms): ${error}`);
      throw new InternalServerErrorException('Failed to fetch auctions from MarketCheck');
    }
  }

  /**
   * Search SCA Auction listings from database with filtering by IDs
   * Used for favorites filtering
   */
  async searchScaAuctionsFromDb(query: QueryScaAuctionDto) {
    const {
      page = 1,
      limit = 25,
      ids,
      sortOrder = 'desc',
    } = query;

    // Parse IDs filter (comma-separated string)
    const idList = ids ? ids.split(',').filter((id) => id.trim()) : [];

    if (idList.length === 0) {
      return {
        data: [],
        meta: {
          page,
          limit,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
    }

    const skip = (page - 1) * limit;

    // Build where clause - search by externalId since that's what the frontend uses
    const where: Prisma.MarketCheckAuctionListingWhereInput = {
      externalId: { in: idList },
    };

    // Execute queries in parallel
    const [listings, total] = await Promise.all([
      this.prisma.marketCheckAuctionListing.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: sortOrder },
      }),
      this.prisma.marketCheckAuctionListing.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: listings,
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  /**
   * Search SCA Auction listings directly from MarketCheck API
   * Fetches data on-demand with pagination
   * If ids parameter is provided, fetches from database instead (for favorites filtering)
   */
  async searchScaAuctions(query: QueryScaAuctionDto) {
    const {
      page = 1,
      limit = 25,
      search,
      make,
      model,
      year,
      bodyType,
      transmission,
      fuelType,
      drivetrain,
      locationState,
      minMiles,
      maxMiles,
      sortBy = 'first_seen_at_date',
      sortOrder = 'desc',
      ids,
    } = query;

    // If IDs are provided, fetch from database (for favorites filtering)
    if (ids) {
      return this.searchScaAuctionsFromDb(query);
    }

    // Calculate start offset for MarketCheck API
    const start = (page - 1) * limit;

    // Build query params for MarketCheck API
    const params = new URLSearchParams({
      api_key: this.apiKey,
      source: 'sca.auction',
      rows: String(limit),
      start: String(start),
      sort_by: sortBy,
      sort_order: sortOrder,
    });

    // Add optional filters
    if (search) params.append('vins', search); // MarketCheck uses 'vins' for VIN search
    if (make) params.append('make', make);
    if (model) params.append('model', model);
    if (year) params.append('year', String(year));
    if (bodyType) params.append('body_type', bodyType);
    if (transmission) params.append('transmission', transmission);
    if (fuelType) params.append('fuel_type', fuelType);
    if (drivetrain) params.append('drivetrain', drivetrain);
    if (locationState) params.append('state', locationState);
    if (minMiles || maxMiles) {
      const min = minMiles || 0;
      const max = maxMiles || 999999;
      params.append('miles_range', `${min}-${max}`);
    }

    const url = `${this.auctionUrl}/active?${params.toString()}`;
    const safeUrl = url.replace(/api_key=[^&]+/, 'api_key=***');

    this.logger.log(`→ MarketCheck SCA Auction API GET ${safeUrl}`);
    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
      });

      const duration = Date.now() - startTime;

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `← MarketCheck SCA Auction API ${response.status} ${response.statusText} (${duration}ms)`,
        );
        this.logger.error(`← MarketCheck SCA Auction API Error Body: ${errorBody}`);
        throw new InternalServerErrorException('Failed to fetch SCA auctions from MarketCheck');
      }

      const data = await response.json();
      const listings = data.listings || [];
      const numFound = data.num_found || 0;

      this.logger.log(`← MarketCheck SCA Auction API 200 OK (${duration}ms) num_found=${numFound} listings=${listings.length}`);

      // Map API response to our format
      const mappedListings = listings.map((listing: any) => ({
        id: listing.id,
        externalId: listing.id,
        vin: listing.vin,
        heading: listing.heading ?? null,
        miles: listing.miles ?? null,
        dataSource: listing.data_source ?? null,
        vdpUrl: listing.vdp_url ?? null,
        carfax1Owner: listing.carfax_1_owner ?? false,
        carfaxCleanTitle: listing.carfax_clean_title ?? false,
        exteriorColor: listing.exterior_color ?? null,
        interiorColor: listing.interior_color ?? null,
        dom: listing.dom ?? null,
        domActive: listing.dom_active ?? null,
        sellerType: listing.seller_type ?? null,
        inventoryType: listing.inventory_type ?? null,
        firstSeenAtDate: listing.first_seen_at_date ?? null,
        source: listing.source ?? 'sca.auction',
        // Location
        locationCity: listing.car_location?.city ?? null,
        locationState: listing.car_location?.state ?? null,
        locationZip: listing.car_location?.zip ?? null,
        // Media
        photoLinks: listing.media?.photo_links ?? [],
        // Dealer
        dealerName: listing.dealer?.name ?? null,
        dealerCity: listing.dealer?.city ?? null,
        dealerState: listing.dealer?.state ?? null,
        // Build info
        year: listing.build?.year ?? null,
        make: listing.build?.make ?? null,
        model: listing.build?.model ?? null,
        bodyType: listing.build?.body_type ?? null,
        transmission: listing.build?.transmission ?? null,
        drivetrain: listing.build?.drivetrain ?? null,
        fuelType: listing.build?.fuel_type ?? null,
        engine: listing.build?.engine ?? null,
        cylinders: listing.build?.cylinders ?? null,
      }));

      const totalPages = Math.ceil(numFound / limit);

      // Store listings in database for favorites functionality
      // We await this to ensure listings exist before user tries to favorite them
      try {
        await this.storeListingsInDatabase(listings);
      } catch (err) {
        this.logger.warn(`Listing storage failed: ${err.message}`);
      }

      return {
        data: mappedListings,
        meta: {
          page,
          limit,
          total: numFound,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      };
    } catch (error) {
      if (error instanceof InternalServerErrorException) throw error;
      this.logger.error(`← MarketCheck SCA Auction API FAILED: ${error}`);
      throw new InternalServerErrorException('Failed to fetch SCA auctions from MarketCheck');
    }
  }

  /**
   * Store listings in database
   * This enables favorites functionality by ensuring listings exist in the database
   */
  private async storeListingsInDatabase(listings: any[]): Promise<void> {
    for (const listing of listings) {
      try {
        const dbRecord = this.mapListingToDbRecord(listing);
        await this.prisma.marketCheckAuctionListing.upsert({
          where: { externalId: listing.id },
          update: dbRecord,
          create: dbRecord,
        });
      } catch (err) {
        this.logger.debug(`Failed to store listing ${listing.id}: ${err.message}`);
      }
    }
    this.logger.debug(`Stored ${listings.length} listings in background`);
  }

  /**
   * Fetch SCA Auction listings from MarketCheck API and store in database
   */
  async fetchAndStoreScaAuctions(): Promise<number> {
    const SCA_SOURCE = 'sca.auction';
    const ROWS_PER_PAGE = 50;
    let start = 0;
    let totalFetched = 0;
    let totalStored = 0;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        api_key: this.apiKey,
        source: SCA_SOURCE,
        rows: String(ROWS_PER_PAGE),
        start: String(start),
      });

      const url = `${this.auctionUrl}/active?${params.toString()}`;
      const safeUrl = url.replace(/api_key=[^&]+/, 'api_key=***');

      this.logger.log(`→ MarketCheck SCA Auction API GET ${safeUrl}`);
      const startTime = Date.now();

      try {
        const response = await fetch(url, {
          headers: { Accept: 'application/json' },
        });

        const duration = Date.now() - startTime;

        if (!response.ok) {
          const errorBody = await response.text();
          this.logger.error(
            `← MarketCheck SCA Auction API ${response.status} ${response.statusText} (${duration}ms)`,
          );
          this.logger.error(`← MarketCheck SCA Auction API Error Body: ${errorBody}`);
          throw new InternalServerErrorException('Failed to fetch SCA auctions from MarketCheck');
        }

        const data = await response.json();
        const listings = data.listings || [];
        const numFound = data.num_found || 0;

        this.logger.log(`← MarketCheck SCA Auction API 200 OK (${duration}ms) num_found=${numFound} listings=${listings.length}`);

        if (listings.length === 0) {
          hasMore = false;
          break;
        }

        // Store listings in database
        for (const listing of listings) {
          try {
            await this.prisma.marketCheckAuctionListing.upsert({
              where: { externalId: listing.id },
              update: this.mapListingToDbRecord(listing),
              create: this.mapListingToDbRecord(listing),
            });
            totalStored++;
          } catch (error) {
            this.logger.warn(`Failed to store listing ${listing.id}: ${error.message}`);
          }
        }

        totalFetched += listings.length;
        start += ROWS_PER_PAGE;

        // Check if we've fetched all available listings
        if (start >= numFound || listings.length < ROWS_PER_PAGE) {
          hasMore = false;
        }

        // Safety limit to avoid infinite loops
        if (totalFetched >= 1000) {
          this.logger.warn('Reached safety limit of 1000 listings');
          hasMore = false;
        }
      } catch (error) {
        if (error instanceof InternalServerErrorException) throw error;
        this.logger.error(`← MarketCheck SCA Auction API FAILED: ${error}`);
        throw new InternalServerErrorException('Failed to fetch SCA auctions from MarketCheck');
      }
    }

    this.logger.log(`SCA Auction sync complete: fetched=${totalFetched}, stored=${totalStored}`);
    return totalStored;
  }

  /**
   * Map API listing to database record
   */
  private mapListingToDbRecord(listing: any): Prisma.MarketCheckAuctionListingCreateInput {
    return {
      externalId: listing.id,
      vin: listing.vin,
      heading: listing.heading ?? null,
      miles: listing.miles ?? null,
      dataSource: listing.data_source ?? null,
      vdpUrl: listing.vdp_url ?? null,
      carfax1Owner: listing.carfax_1_owner ?? false,
      carfaxCleanTitle: listing.carfax_clean_title ?? false,
      exteriorColor: listing.exterior_color ?? null,
      interiorColor: listing.interior_color ?? null,
      baseExtColor: listing.base_ext_color ?? null,
      baseIntColor: listing.base_int_color ?? null,
      dom: listing.dom ?? null,
      dom180: listing.dom_180 ?? null,
      domActive: listing.dom_active ?? null,
      dosActive: listing.dos_active ?? null,
      sellerType: listing.seller_type ?? null,
      inventoryType: listing.inventory_type ?? null,
      lastSeenAt: listing.last_seen_at ?? null,
      lastSeenAtDate: listing.last_seen_at_date ? new Date(listing.last_seen_at_date) : null,
      scrapedAt: listing.scraped_at ?? null,
      scrapedAtDate: listing.scraped_at_date ? new Date(listing.scraped_at_date) : null,
      firstSeenAt: listing.first_seen_at ?? null,
      firstSeenAtDate: listing.first_seen_at_date ? new Date(listing.first_seen_at_date) : null,
      firstSeenAtMc: listing.first_seen_at_mc ?? null,
      firstSeenAtMcDate: listing.first_seen_at_mc_date ? new Date(listing.first_seen_at_mc_date) : null,
      firstSeenAtSource: listing.first_seen_at_source ?? null,
      firstSeenAtSourceDate: listing.first_seen_at_source_date ? new Date(listing.first_seen_at_source_date) : null,
      source: listing.source ?? 'sca.auction',
      inTransit: listing.in_transit ?? false,

      // Car location
      locationStreet: listing.car_location?.street ?? null,
      locationCity: listing.car_location?.city ?? null,
      locationZip: listing.car_location?.zip ?? null,
      locationState: listing.car_location?.state ?? null,
      locationLatitude: listing.car_location?.latitude ?? null,
      locationLongitude: listing.car_location?.longitude ?? null,

      // Media
      photoLinks: listing.media?.photo_links ?? [],

      // Dealer info
      dealerId: listing.dealer?.id ?? null,
      dealerWebsite: listing.dealer?.website ?? null,
      dealerName: listing.dealer?.name ?? null,
      dealerStreet: listing.dealer?.street ?? null,
      dealerCity: listing.dealer?.city ?? null,
      dealerState: listing.dealer?.state ?? null,
      dealerCountry: listing.dealer?.country ?? null,
      dealerLatitude: listing.dealer?.latitude ?? null,
      dealerLongitude: listing.dealer?.longitude ?? null,
      dealerZip: listing.dealer?.zip ?? null,
      dealerMsaCode: listing.dealer?.msa_code ?? null,
      dealerPhone: listing.dealer?.phone ?? null,
      dealerEmail: listing.dealer?.email ?? null,

      // MC Dealership
      mcWebsiteId: listing.mc_dealership?.website_id ?? null,
      mcDealerId: listing.mc_dealership?.dealer_id ?? null,
      mcLocationId: listing.mc_dealership?.location_id ?? null,
      mcRooftopId: listing.mc_dealership?.rooftop_id ?? null,
      mcCategory: listing.mc_dealership?.category ?? null,

      // Build info
      year: listing.build?.year ?? null,
      make: listing.build?.make ?? null,
      model: listing.build?.model ?? null,
      bodyType: listing.build?.body_type ?? null,
      vehicleType: listing.build?.vehicle_type ?? null,
      transmission: listing.build?.transmission ?? null,
      drivetrain: listing.build?.drivetrain ?? null,
      fuelType: listing.build?.fuel_type ?? null,
      engine: listing.build?.engine ?? null,
      engineSize: listing.build?.engine_size ?? null,
      engineBlock: listing.build?.engine_block ?? null,
      cylinders: listing.build?.cylinders ?? null,
      powertrainType: listing.build?.powertrain_type ?? null,
    };
  }

  /**
   * Get a single SCA Auction listing by ID
   */
  async findScaAuctionById(id: string) {
    return this.prisma.marketCheckAuctionListing.findUnique({
      where: { id },
    });
  }

  /**
   * Get a single SCA Auction listing by external ID (MarketCheck ID)
   */
  async findScaAuctionByExternalId(externalId: string) {
    return this.prisma.marketCheckAuctionListing.findUnique({
      where: { externalId },
    });
  }

  /**
   * Get filter options for SCA Auction listings
   */
  async getScaAuctionFilterOptions() {
    const [makes, bodyTypes, states, years, transmissions, drivetrains, fuelTypes] = await Promise.all([
      this.prisma.$queryRaw<{ make: string }[]>`
        SELECT DISTINCT make FROM marketcheck_auction_listings WHERE make IS NOT NULL AND source = 'sca.auction' ORDER BY make
      `,
      this.prisma.$queryRaw<{ bodyType: string }[]>`
        SELECT DISTINCT "bodyType" FROM marketcheck_auction_listings WHERE "bodyType" IS NOT NULL AND source = 'sca.auction' ORDER BY "bodyType"
      `,
      this.prisma.$queryRaw<{ locationState: string }[]>`
        SELECT DISTINCT "locationState" FROM marketcheck_auction_listings WHERE "locationState" IS NOT NULL AND source = 'sca.auction' ORDER BY "locationState"
      `,
      this.prisma.$queryRaw<{ year: number }[]>`
        SELECT DISTINCT year FROM marketcheck_auction_listings WHERE year IS NOT NULL AND source = 'sca.auction' ORDER BY year DESC
      `,
      this.prisma.$queryRaw<{ transmission: string }[]>`
        SELECT DISTINCT transmission FROM marketcheck_auction_listings WHERE transmission IS NOT NULL AND source = 'sca.auction' ORDER BY transmission
      `,
      this.prisma.$queryRaw<{ drivetrain: string }[]>`
        SELECT DISTINCT drivetrain FROM marketcheck_auction_listings WHERE drivetrain IS NOT NULL AND source = 'sca.auction' ORDER BY drivetrain
      `,
      this.prisma.$queryRaw<{ fuelType: string }[]>`
        SELECT DISTINCT "fuelType" FROM marketcheck_auction_listings WHERE "fuelType" IS NOT NULL AND source = 'sca.auction' ORDER BY "fuelType"
      `,
    ]);

    return {
      makes: makes.map((m) => m.make),
      bodyTypes: bodyTypes.map((b) => b.bodyType),
      states: states.map((s) => s.locationState),
      years: years.map((y) => y.year),
      transmissions: transmissions.map((t) => t.transmission),
      drivetrains: drivetrains.map((d) => d.drivetrain),
      fuelTypes: fuelTypes.map((f) => f.fuelType),
    };
  }
}
