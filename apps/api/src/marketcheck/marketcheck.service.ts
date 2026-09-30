import { Injectable, Logger, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';

interface MarketCheckTermsResponse {
  [field: string]: string[];
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

export interface MarketCheckPriceResult {
  marketcheckPrice: number | null;
  msrp: number | null;
  cached: boolean;
  zip: string;
}

export interface MarketCheckCompsResult {
  listings: any[];
  numFound: number;
  cached: boolean;
  stats?: unknown;
}

/** A comparable listing trimmed to what a market report shows. */
export interface MarketReportListing {
  id: string;
  heading: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  price: number | null;
  miles: number | null;
  exteriorColor: string | null;
  daysOnMarket: number | null;
  distance: number | null;
  dealerName: string | null;
  dealerCity: string | null;
  dealerState: string | null;
  url: string | null;
  photo: string | null;
}

/**
 * MarketCheck price + nearby comparables for one VIN at one ZIP, served from
 * the shared cache when possible. `price` is null when no mileage was given
 * (MarketCheck needs it) and `{ value: null }` when MarketCheck can't price
 * the VIN. With `cacheOnly`, a part that isn't cached comes back null and
 * nothing is paid for. With `refresh`, the cache is skipped and MarketCheck is
 * asked again (paid); the new result replaces the cached one for everyone.
 */
export interface MarketReport {
  vin: string;
  zip: string;
  price: { value: number | null; msrp: number | null; miles: number; cached: boolean; fetchedAt: string } | null;
  comparables: { listings: MarketReportListing[]; numFound: number; cached: boolean; fetchedAt: string } | null;
}

@Injectable()
export class MarketCheckService {
  private readonly logger = new Logger(MarketCheckService.name);
  /** Every MarketCheck call costs money: results are shared from the DB for this long (MARKETCHECK_CACHE_TTL_HOURS, default 7 days). */
  private readonly cacheTtlMs = (Number(process.env.MARKETCHECK_CACHE_TTL_HOURS) || 168) * 3_600_000;
  /** Identical lookups already on their way to MarketCheck — concurrent callers share one paid request. */
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly baseUrl = 'https://api.marketcheck.com/v2/specs/car/terms';
  private readonly decodeUrl = 'https://api.marketcheck.com/v2/decode/car';
  private readonly priceUrl = 'https://api.marketcheck.com/v2/predict/car/us/marketcheck_price';
  private readonly searchUrl = 'https://api.marketcheck.com/v2/search/car/active';
  private readonly apiKey: string;

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

  /**
   * Get MarketCheck price prediction for a vehicle
   * Uses: https://api.marketcheck.com/v2/predict/car/us/marketcheck_price
   */
  async getPrice(
    vin: string,
    miles: number,
    zip: string,
    dealerType = 'independent',
  ): Promise<MarketCheckPriceResult> {
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

        if (response.status === 400) {
          // Remember it: asking again for the same VIN would be paid for and fail the same way.
          await this.savePrice(vin, miles, dealerType, zip, null, null, { error: errorBody.slice(0, 500) });
          throw new BadRequestException('MarketCheck could not decode this VIN for pricing');
        }
        throw new InternalServerErrorException('Failed to fetch price from MarketCheck');
      }

      const data = await response.json();
      this.logger.log(
        `← MarketCheck Price API 200 OK (${duration}ms) RAW RESPONSE: ${JSON.stringify(data)}`,
      );

      const predictedPrice =
        data.predicted_price ?? data.price ?? data.marketcheck_price ?? data.estimated_price ?? null;
      const msrp = data.msrp ?? data.base_msrp ?? null;
      await this.savePrice(vin, miles, dealerType, zip, predictedPrice, msrp, data);

      return {
        marketcheckPrice: predictedPrice,
        msrp,
        cached: false,
        zip,
      };
    } catch (error) {
      const duration = Date.now() - start;
      if (error instanceof BadRequestException || error instanceof InternalServerErrorException) throw error;
      this.logger.error(`← MarketCheck Price API FAILED (${duration}ms): ${error}`);
      throw new InternalServerErrorException('Failed to fetch price from MarketCheck');
    }
  }

  /**
   * Search for comparable active listings
   * Uses: https://api.marketcheck.com/v2/search/car/active
   */
  async getComparables(
    make: string,
    model: string,
    year: string,
    zip: string,
  ): Promise<MarketCheckCompsResult> {
    const params = new URLSearchParams({
      api_key: this.apiKey,
      make,
      model,
      year,
      zip,
      radius: '100',
      rows: '25',
      sort_by: 'dist',
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

      const data = await response.json();
      this.logger.log(
        `← MarketCheck Search API 200 OK (${duration}ms) numFound=${data.num_found}`,
      );

      return {
        listings: data.listings ?? [],
        numFound: data.num_found ?? 0,
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
   * Search for comparable active listings by VIN
   * Uses: https://api.marketcheck.com/v2/search/car/active with vins + match params
   */
  async getComparablesByVin(
    vin: string,
    zip: string,
  ): Promise<MarketCheckCompsResult> {
    if (!vin || vin.length !== 17) {
      throw new BadRequestException('VIN must be exactly 17 characters');
    }

    const params = new URLSearchParams({
      api_key: this.apiKey,
      vins: vin,
      match: 'year,make,model,trim',
      zip,
      radius: '100',
      rows: '25',
      stats: 'price,miles,days_on_market',
      sort_by: 'dist',
      sort_order: 'asc',
    });

    const url = `${this.searchUrl}?${params.toString()}`;
    const safeUrl = url.replace(/api_key=[^&]+/, 'api_key=***');

    this.logger.log(`→ MarketCheck VIN Search API GET ${safeUrl}`);
    const start = Date.now();

    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
      });

      const duration = Date.now() - start;

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `← MarketCheck VIN Search API ${response.status} ${response.statusText} (${duration}ms)`,
        );
        this.logger.error(`← MarketCheck VIN Search API Error Body: ${errorBody}`);
        throw new InternalServerErrorException('Failed to fetch VIN comparables from MarketCheck');
      }

      const data = await response.json();
      this.logger.log(
        `← MarketCheck VIN Search API 200 OK (${duration}ms) numFound=${data.num_found}`,
      );
      const result = { listings: data.listings ?? [], numFound: data.num_found ?? 0, stats: data.stats ?? null };
      await this.saveVinComps(vin, zip, result);

      return { ...result, cached: false };
    } catch (error) {
      const duration = Date.now() - start;
      if (error instanceof InternalServerErrorException) throw error;
      this.logger.error(`← MarketCheck VIN Search API FAILED (${duration}ms): ${error}`);
      throw new InternalServerErrorException('Failed to fetch VIN comparables from MarketCheck');
    }
  }

  // ── Shared cache ──────────────────────────────────────────────────────────
  // Live endpoints above always call MarketCheck (staff "Refresh") and write
  // their result here; getMarketReport reads here first. Rows are keyed by
  // exactly what MarketCheck is asked, so any caller asking the same thing
  // within the TTL reuses one paid response.

  private vinCompsKey(vin: string, zip: string) {
    return `vin-comps:${vin.toUpperCase()}:${zip}`;
  }

  private async savePrice(vin: string, miles: number, dealerType: string, zip: string, price: number | null, msrp: number | null, raw: unknown) {
    const expiresAt = new Date(Date.now() + this.cacheTtlMs);
    const values = { marketcheckPrice: price, msrp, rawResponse: raw as Prisma.InputJsonValue, expiresAt, createdAt: new Date() };
    try {
      await this.prisma.marketCheckPriceCache.upsert({
        where: { vin_miles_dealerType_zip: { vin: vin.toUpperCase(), miles, dealerType, zip } },
        create: { vin: vin.toUpperCase(), miles, dealerType, zip, ...values },
        update: values,
      });
    } catch (err) {
      this.logger.warn(`MarketCheck price cache write failed: ${err}`);
    }
  }

  private async saveVinComps(vin: string, zip: string, result: { listings: unknown[]; numFound: number; stats: unknown }) {
    const cacheKey = this.vinCompsKey(vin, zip);
    const values = {
      listings: result.listings as Prisma.InputJsonValue,
      numFound: result.numFound,
      stats: (result.stats ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + this.cacheTtlMs),
      createdAt: new Date(),
    };
    try {
      await this.prisma.marketCheckAuctionCache.upsert({ where: { cacheKey }, create: { cacheKey, ...values }, update: values });
    } catch (err) {
      this.logger.warn(`MarketCheck comps cache write failed: ${err}`);
    }
  }

  /** Runs `fn` once per key at a time; concurrent callers await the same promise. */
  private once<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const running = this.inflight.get(key) as Promise<T> | undefined;
    if (running) return running;
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async cachedPrice(vin: string, miles: number, zip: string, cacheOnly: boolean, refresh: boolean): Promise<MarketReport['price']> {
    const dealerType = 'independent';
    const where = { vin_miles_dealerType_zip: { vin, miles, dealerType, zip } };
    const hit = refresh ? null : await this.prisma.marketCheckPriceCache.findUnique({ where });
    if (hit && hit.expiresAt > new Date()) {
      return {
        value: hit.marketcheckPrice === null ? null : Number(hit.marketcheckPrice),
        msrp: hit.msrp === null ? null : Number(hit.msrp),
        miles,
        cached: true,
        fetchedAt: hit.createdAt.toISOString(),
      };
    }
    if (cacheOnly) return null;
    return this.once(`price:${vin}:${miles}:${zip}`, async () => {
      try {
        const r = await this.getPrice(vin, miles, zip, dealerType);
        return { value: r.marketcheckPrice, msrp: r.msrp, miles, cached: false, fetchedAt: new Date().toISOString() };
      } catch (err) {
        // Not priceable (cached above as a null price); anything else propagates.
        if (err instanceof BadRequestException) return { value: null, msrp: null, miles, cached: false, fetchedAt: new Date().toISOString() };
        throw err;
      }
    });
  }

  private async cachedVinComps(vin: string, zip: string, cacheOnly: boolean, refresh: boolean): Promise<MarketReport['comparables']> {
    const hit = refresh ? null : await this.prisma.marketCheckAuctionCache.findUnique({ where: { cacheKey: this.vinCompsKey(vin, zip) } });
    if (hit && hit.expiresAt > new Date()) {
      return { listings: this.slimListings(hit.listings, vin), numFound: hit.numFound, cached: true, fetchedAt: hit.createdAt.toISOString() };
    }
    if (cacheOnly) return null;
    return this.once(`comps:${vin}:${zip}`, async () => {
      const r = await this.getComparablesByVin(vin, zip);
      return { listings: this.slimListings(r.listings, vin), numFound: r.numFound, cached: false, fetchedAt: new Date().toISOString() };
    });
  }

  /** Only the fields a market report shows; the subject vehicle itself is left out. */
  private slimListings(raw: unknown, vin: string): MarketReportListing[] {
    const list = Array.isArray(raw) ? (raw as any[]) : [];
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    return list
      .filter((l) => l && String(l.vin ?? '').toUpperCase() !== vin)
      .map((l) => ({
        id: String(l.id ?? l.vin ?? ''),
        heading: str(l.heading),
        year: num(l.build?.year),
        make: str(l.build?.make),
        model: str(l.build?.model),
        trim: str(l.build?.trim),
        price: num(l.price),
        miles: num(l.miles),
        exteriorColor: str(l.exterior_color),
        daysOnMarket: num(l.dom),
        distance: num(l.dist),
        dealerName: str(l.dealer?.name),
        dealerCity: str(l.dealer?.city),
        dealerState: str(l.dealer?.state),
        url: str(l.vdp_url),
        photo: str(l.media?.photo_links?.[0]),
      }));
  }

  /**
   * MarketCheck price + comparables for a VIN near a ZIP, cache first. Only a
   * cache miss calls (and pays) MarketCheck; the result is then shared with
   * every later caller for the TTL.
   */
  async getMarketReport(vinRaw: string, zip: string, miles: number | null, cacheOnly = false, refresh = false): Promise<MarketReport> {
    const vin = (vinRaw || '').toUpperCase();
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) throw new BadRequestException('VIN must be 17 characters');
    if (!/^\d{5}$/.test(zip || '')) throw new BadRequestException('zip must be a 5-digit US ZIP code');
    const [price, comparables] = await Promise.all([
      miles !== null && miles > 0 ? this.cachedPrice(vin, miles, zip, cacheOnly, refresh && !cacheOnly) : Promise.resolve(null),
      this.cachedVinComps(vin, zip, cacheOnly, refresh && !cacheOnly),
    ]);
    return { vin, zip, price, comparables };
  }
}
