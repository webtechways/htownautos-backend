import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { geocodeZip, iaaiGalleryImages, iaaiSaleParts, normalizeToken, parseEngineSizeL } from '@htownautos/common';
import { OpenSearchService } from './opensearch.service';
import { AUCTION_INDEX_NAME, AuctionIndexService } from './auction-index.service';
import { UnifiedAuction } from './dto/unified-auction.interface';

/**
 * IAAI lots live in their own index, separate from Copart's `auction_listings`:
 * every consumer of the Copart index (Stats, PrecioFinal, the portal, sitemaps)
 * keeps seeing only Copart, and a Copart "delete & reindex" never wipes IAAI.
 * The documents have the SAME shape and the index the SAME mapping, so the
 * Copart search (query, facets, sort) runs on it unchanged.
 */
export const IAAI_INDEX_NAME = 'iaai_listings';

/**
 * Version of the IAAI document shape, kept in the index's _meta. When the code
 * changes how a document is built, bump it: data-sync sees the mismatch on
 * start and re-indexes everything by itself.
 *   2 = Copart vocabulary (canonical make/model, damage, runs/drives, odometer,
 *       yard) + publicListing
 */
export const IAAI_DOC_VERSION = 2;

/** Columns the document needs (never the heavy `raw`). */
export const IAAI_INDEX_SELECT = {
  stockNumber: true, vin: true, year: true, make: true, model: true, series: true, bodyStyle: true, color: true,
  engineSize: true, transmission: true, fuelType: true, drivelineType: true, cylinders: true, odometer: true,
  odometerStatus: true, primaryDamage: true, secondaryDamage: true, saleDocument: true, certState: true,
  runAndDrive: true, startCode: true, keys: true, acv: true, repairCost: true, currentBid: true, buyNowPrice: true,
  branchCode: true, branchName: true, locationCity: true, locationState: true, locationZip: true, seller: true,
  auctionAt: true, vehicleStatus: true, imageSourceUrls: true, images: true, isActive: true, firstSeenAt: true, updatedAt: true,
  yard: { select: { latitude: true, longitude: true, state: true } },
} satisfies Prisma.IaaiListingSelect;
type Row = Prisma.IaaiListingGetPayload<{ select: typeof IAAI_INDEX_SELECT }>;

const docId = (stock: string) => `iaai_${stock}`;

// ── IAAI → Copart vocabulary ───────────────────────────────────────────────
// Both indexes are searched together (PrecioFinal's listing), so IAAI values
// are written in Copart's terms or every facet splits in two ("Front End" next
// to "FRONT END"). Postgres keeps IAAI's original value.

const DAMAGE: Record<string, string> = {
  'FRONT END': 'FRONT END', FRONT: 'FRONT END', 'RIGHT FRONT': 'FRONT END', 'LEFT FRONT': 'FRONT END', 'FRONT & REAR': 'FRONT END',
  REAR: 'REAR END', 'LEFT REAR': 'REAR END', 'RIGHT REAR': 'REAR END',
  'LEFT SIDE': 'SIDE', 'RIGHT SIDE': 'SIDE', 'LEFT & RIGHT SIDE': 'SIDE',
  'NORMAL WEAR & TEAR': 'NORMAL WEAR', NONE: 'NORMAL WEAR',
  FLOOD: 'WATER/FLOOD', 'FRESH WATER': 'WATER/FLOOD', 'SALT WATER': 'WATER/FLOOD', 'STORM DAMAGE': 'WATER/FLOOD',
  HAIL: 'HAIL', 'ALL OVER': 'ALL OVER', ROLLOVER: 'ROLLOVER', ROOF: 'TOP/ROOF', UNDERCARRIAGE: 'UNDERCARRIAGE',
  BIOHAZARD: 'BIOHAZARD/CHEMICAL', 'TOTAL BURN': 'BURN', 'EXTERIOR BURN': 'BURN', 'ENGINE BURN': 'BURN - ENGINE',
  'INTERIOR BURN': 'BURN - INTERIOR', MECHANICAL: 'MECHANICAL', 'ENGINE DAMAGE': 'MECHANICAL',
  'TRANSMISSION DAMAGE': 'MECHANICAL', ELECTRICAL: 'MECHANICAL', SUSPENSION: 'MECHANICAL', 'POSSIBLE MECH.': 'MECHANICAL',
  VANDALIZED: 'VANDALISM', FRAME: 'FRAME DAMAGE', STRIP: 'STRIPPED', UNKNOWN: 'UNKNOWN',
};
const damageOf = (v: string | null) => {
  const k = normalizeToken(v);
  return k ? DAMAGE[k] ?? k : null;
};
const COLOR: Record<string, string> = { GREY: 'GRAY' };
const ODOMETER: Record<string, string> = { ACTUAL: 'A', 'NOT ACTUAL': 'N', EXEMPT: 'E', 'EXCEEDS MECHANICAL LIMITS': 'X' };
/** Copart's Run & Drive vocabulary: Run & Drive Verified / Vehicle Starts / DEFAULT. */
const runsDrivesOf = (runAndDrive: boolean | null, startCode: string | null) =>
  runAndDrive ? 'Run & Drive Verified' : startCode === 'STARTS' ? 'Vehicle Starts' : startCode ? 'DEFAULT' : null;
/** Letters and digits only: "F-150" and "F150" are the same model. */
const squash = (v: string) => v.replace(/[^A-Z0-9]/g, '');

/** Copart's canonical makes and models (per make), to map IAAI's spelling onto. */
interface CopartVocab {
  makes: Map<string, string>; // squashed → canonical
  models: Map<string, Map<string, string>>; // make → squashed → canonical
}

@Injectable()
export class IaaiIndexService {
  private readonly logger = new Logger(IaaiIndexService.name);
  private ready = false;
  private vocab: { at: number; v: CopartVocab } | null = null;

  /** Copart's live make/model vocabulary (one DISTINCT over the active lots, cached 6 h). */
  private async copartVocab(): Promise<CopartVocab> {
    if (this.vocab && Date.now() - this.vocab.at < 6 * 3600_000) return this.vocab.v;
    // With counts: Copart itself has both "F150" and "F-150"; when two
    // spellings collapse to the same key, the most common one wins.
    const rows = await this.prisma.$queryRaw<{ mk: string; mo: string | null; n: number }[]>`
      SELECT "makeCanonical" AS mk, "modelCanonical" AS mo, COUNT(*)::int AS n
      FROM auction_listings
      WHERE "isStale" = false AND "makeCanonical" IS NOT NULL
      GROUP BY 1, 2`;
    this.vocab = { at: Date.now(), v: IaaiIndexService.buildVocab(rows) };
    return this.vocab.v;
  }

  /** Squashed spelling → the most common Copart canonical value (makes, and models per make). */
  static buildVocab(rows: { mk: string; mo: string | null; n: number }[]): CopartVocab {
    const v: CopartVocab = { makes: new Map(), models: new Map() };
    const makeN = new Map<string, number>();
    const modelN = new Map<string, number>();
    for (const r of rows) {
      const mkKey = squash(r.mk);
      const mkTotal = (makeN.get(r.mk) ?? 0) + r.n;
      makeN.set(r.mk, mkTotal);
      const cur = v.makes.get(mkKey);
      if (!cur || (makeN.get(cur) ?? 0) < mkTotal) v.makes.set(mkKey, r.mk);
      if (!r.mo) continue;
      if (!v.models.has(r.mk)) v.models.set(r.mk, new Map());
      const models = v.models.get(r.mk)!;
      const k = squash(r.mo);
      modelN.set(`${r.mk}|${r.mo}`, r.n);
      const prev = models.get(k);
      if (!prev || (modelN.get(`${r.mk}|${prev}`) ?? 0) < r.n) models.set(k, r.mo);
    }
    return v;
  }

  /**
   * IAAI make/model in Copart's canonical spelling: exact, then ignoring
   * punctuation ("F-150" → "F150"), then the longest leading words that are a
   * Copart model ("F-250 SUPER DUTY" → "F250"). No match keeps IAAI's value.
   */
  private canonicalMakeModel(make: string | null, model: string | null, v: CopartVocab) {
    const mk0 = normalizeToken(make);
    const mk = mk0 ? v.makes.get(squash(mk0)) ?? mk0 : null;
    const mo0 = normalizeToken(model);
    if (!mk || !mo0) return { make: mk, model: mo0 };
    const models = v.models.get(mk);
    if (!models) return { make: mk, model: mo0 };
    const words = mo0.split(' ');
    for (let n = words.length; n >= 1; n--) {
      const hit = models.get(squash(words.slice(0, n).join(' ')));
      if (hit) return { make: mk, model: hit };
    }
    return { make: mk, model: mo0 };
  }

  constructor(
    private readonly openSearch: OpenSearchService,
    private readonly auctionIndex: AuctionIndexService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Create the index if missing, with the live Copart index's mapping: the
   * production Copart index was built by dynamic mapping (text + .keyword),
   * and the search queries `.keyword` subfields, so copying it is what makes
   * the same queries behave the same here.
   */
  async ensureIndex(): Promise<void> {
    if (this.ready) return;
    const client = this.openSearch.getClient();
    if ((await client.indices.exists({ index: IAAI_INDEX_NAME })).body) {
      this.ready = true;
      return;
    }
    let mappings: any = null;
    let analysis: any = null;
    try {
      const res = await client.indices.getMapping({ index: AUCTION_INDEX_NAME });
      mappings = (Object.values(res.body)[0] as any)?.mappings ?? null;
      // The mapping references custom analyzers (e.g. lowercase_analyzer):
      // they live in the index settings and must come along.
      const st = await client.indices.getSettings({ index: AUCTION_INDEX_NAME });
      analysis = (Object.values(st.body)[0] as any)?.settings?.index?.analysis ?? null;
    } catch (err) {
      this.logger.warn(`Could not read ${AUCTION_INDEX_NAME} mapping: ${(err as Error).message}`);
    }
    if (mappings) {
      await client.indices.create({
        index: IAAI_INDEX_NAME,
        body: { mappings, ...(analysis && { settings: { index: { analysis } } }) },
      });
    } else {
      // No Copart index to copy from (fresh environment): dynamic mapping, as prod was built.
      await client.indices.create({ index: IAAI_INDEX_NAME });
    }
    this.logger.log(`Created index ${IAAI_INDEX_NAME}${mappings ? ' (mapping copied from Copart)' : ''}`);
    this.ready = true;
    await this.stampVersion();
  }

  /** True when the index was built by an older document shape (or does not exist). */
  async needsReindex(): Promise<boolean> {
    const client = this.openSearch.getClient();
    if (!(await client.indices.exists({ index: IAAI_INDEX_NAME })).body) return false; // created on first index
    const res = await client.indices.getMapping({ index: IAAI_INDEX_NAME });
    const meta = (Object.values(res.body)[0] as any)?.mappings?._meta;
    return meta?.iaaiDocVersion !== IAAI_DOC_VERSION;
  }

  private async stampVersion(): Promise<void> {
    await this.openSearch.getClient().indices.putMapping({ index: IAAI_INDEX_NAME, body: { _meta: { iaaiDocVersion: IAAI_DOC_VERSION } } });
  }

  async deleteIndex(): Promise<void> {
    await this.openSearch.deleteIndex(IAAI_INDEX_NAME);
    this.ready = false;
  }

  async count(): Promise<number> {
    try {
      return await this.openSearch.count(IAAI_INDEX_NAME);
    } catch {
      return 0;
    }
  }

  /** Index (or re-index) these lots; inactive ones are removed from the index instead. */
  async indexStocks(stocks: string[]): Promise<{ indexed: number; removed: number; failed: number }> {
    if (!stocks.length) return { indexed: 0, removed: 0, failed: 0 };
    await this.ensureIndex();
    const rows = await this.prisma.iaaiListing.findMany({ where: { stockNumber: { in: stocks } }, select: IAAI_INDEX_SELECT });
    return this.indexRows(rows);
  }

  async indexRows(rows: Row[]): Promise<{ indexed: number; removed: number; failed: number }> {
    await this.ensureIndex();
    const active = rows.filter((r) => r.isActive);
    const vocab = await this.copartVocab();
    const res = await this.openSearch.bulkIndex(
      IAAI_INDEX_NAME,
      active.map((r) => ({ id: docId(r.stockNumber), body: this.toDocument(r, vocab) })),
    );
    if (res.failed) this.logger.warn(`IAAI index: ${res.failed} failed — ${res.errors.slice(0, 3).join(' | ')}`);
    const removed = await this.removeStocks(rows.filter((r) => !r.isActive).map((r) => r.stockNumber));
    return { indexed: res.success, removed, failed: res.failed };
  }

  async removeStocks(stocks: string[]): Promise<number> {
    if (!stocks.length) return 0;
    const client = this.openSearch.getClient();
    try {
      const body = stocks.map((s) => ({ delete: { _index: IAAI_INDEX_NAME, _id: docId(s) } }));
      const res = await client.bulk({ body, refresh: false });
      return ((res.body?.items ?? []) as any[]).filter((i) => i.delete?.result === 'deleted').length;
    } catch (err) {
      this.logger.warn(`IAAI index delete failed: ${(err as Error).message}`);
      return 0;
    }
  }

  /**
   * Re-index every active lot, in batches. `onProgress` gets (done, total).
   * With `recreate` the index is dropped first, so documents of lots that are
   * gone disappear too.
   */
  async reindexAll(recreate: boolean, onProgress?: (done: number, total: number) => Promise<void>): Promise<number> {
    if (recreate) await this.deleteIndex();
    await this.ensureIndex();
    const total = await this.prisma.iaaiListing.count({ where: { isActive: true } });
    let done = 0;
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.prisma.iaaiListing.findMany({
        where: { isActive: true },
        orderBy: { stockNumber: 'asc' },
        take: 1000,
        ...(cursor && { cursor: { stockNumber: cursor }, skip: 1 }),
        select: IAAI_INDEX_SELECT,
      });
      if (!rows.length) break;
      const r = await this.indexRows(rows);
      done += r.indexed;
      cursor = rows[rows.length - 1].stockNumber;
      await onProgress?.(done, total);
    }
    await this.stampVersion();
    return done;
  }

  /** One IAAI lot in the unified auction document shape (the Copart one). */
  toDocument(r: Row, vocab: CopartVocab): UnifiedAuction {
    const canon = this.canonicalMakeModel(r.make, r.model, vocab);
    const color = normalizeToken(r.color);
    const state = r.yard?.state ?? r.locationState;
    const branch = normalizeToken(r.branchName);
    const cached = r.images as { images?: { thumbnail: string; fullSize: string }[] } | null;
    const gallery = cached?.images?.length ? cached.images : iaaiGalleryImages(r.imageSourceUrls);
    const lat = r.yard?.latitude;
    const lon = r.yard?.longitude;
    const geo = lat != null && lon != null ? { lat, lon } : geocodeZip(r.locationZip);
    const sale = iaaiSaleParts(r.auctionAt);
    return {
      id: `iaai-${r.stockNumber}`,
      source: 'iaai',
      sourceId: r.stockNumber,
      vin: r.vin,
      year: r.year,
      make: r.make,
      model: r.model,
      trim: r.series,
      bodyType: r.bodyStyle,
      color: r.color,
      interiorColor: null,
      makeCanonical: canon.make,
      modelCanonical: canon.model,
      trimCanonical: normalizeToken(r.series),
      colorCanonical: color ? COLOR[color] ?? color : null,
      engine: r.engineSize,
      transmission: r.transmission,
      fuelType: r.fuelType,
      drivetrain: r.drivelineType,
      cylinders: r.cylinders,
      odometer: r.odometer,
      odometerBrand: r.odometerStatus ? ODOMETER[r.odometerStatus.toUpperCase()] ?? r.odometerStatus : null,
      locationCity: r.locationCity,
      // The branch's state (Yards table): IAAI's address state is sometimes wrong.
      locationState: state,
      locationZip: r.locationZip,
      locationCountry: 'US',
      images: gallery.map((g) => g.thumbnail),
      mainImage: gallery[0]?.thumbnail ?? null,
      createdAt: r.firstSeenAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      indexedAt: new Date().toISOString(),
      damageDescription: damageOf(r.primaryDamage),
      secondaryDamage: damageOf(r.secondaryDamage),
      ...sale,
      // The index maps this as a date and Copart writes YYYY-MM-DD.
      saleDateFormatted: sale.saleDate ? `${String(sale.saleDate).slice(0, 4)}-${String(sale.saleDate).slice(4, 6)}-${String(sale.saleDate).slice(6, 8)}` : null,
      saleStatus: r.vehicleStatus,
      saleTitleState: r.certState,
      saleTitleType: r.saleDocument,
      hasKeys: r.keys === 'PRESENT' ? 'YES' : r.keys ? 'NO' : null,
      runsDrives: runsDrivesOf(r.runAndDrive, r.startCode),
      lotCondCode: r.startCode,
      wholesale: null,
      saleLight: null,
      highBid: r.currentBid,
      buyItNowPrice: r.buyNowPrice,
      // IAAI's ACV (actual cash value) is not Copart's retail value: own field.
      estRetailValue: null,
      acv: r.acv,
      repairCost: r.repairCost,
      // Copart's "ST - CITY" format, marked IAAI so it never merges with the
      // Copart yard of the same city.
      yardName: branch ? `${state ? `${state} - ` : ''}${branch} (IAAI)` : null,
      yardNumber: r.branchCode,
      itemNumber: null,
      sellerName: r.seller,
      sellerCategory: null,
      engineSizeL: parseEngineSizeL(r.engineSize),
      geoPoint: geo ? { lat: geo.lat, lon: geo.lon } : null,
      vectorPca: null,
      discarded: false,
      // Public listing (PrecioFinal): only lots with photos and a real make.
      publicListing: gallery.length > 0 && !!canon.make && canon.make !== 'OTHER',
      discardReason: null,
      discardedAt: null,
      carfax1Owner: null,
      carfaxCleanTitle: null,
      dom: null,
      domActive: null,
      dealerName: null,
      dealerCity: null,
      dealerState: null,
      dealerPhone: null,
      heading: null,
      vdpUrl: null,
      sellerType: null,
      inventoryType: null,
    } as UnifiedAuction;
  }
}
