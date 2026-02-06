import { Injectable, Logger, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

interface MarketCheckTermsResponse {
  [field: string]: string[];
}

interface MarketCheckPriceResponse {
  marketcheck_price?: number;
  msrp?: number;
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
}
