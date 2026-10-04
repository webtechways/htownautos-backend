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

/** Columns the document needs (never the heavy `raw`). */
export const IAAI_INDEX_SELECT = {
  stockNumber: true, vin: true, year: true, make: true, model: true, series: true, bodyStyle: true, color: true,
  engineSize: true, transmission: true, fuelType: true, drivelineType: true, cylinders: true, odometer: true,
  odometerStatus: true, primaryDamage: true, secondaryDamage: true, saleDocument: true, certState: true,
  runAndDrive: true, startCode: true, keys: true, acv: true, repairCost: true, currentBid: true, buyNowPrice: true,
  branchCode: true, branchName: true, locationCity: true, locationState: true, locationZip: true, seller: true,
  auctionAt: true, vehicleStatus: true, imageSourceUrls: true, images: true, isActive: true, firstSeenAt: true, updatedAt: true,
  yard: { select: { latitude: true, longitude: true } },
} satisfies Prisma.IaaiListingSelect;
type Row = Prisma.IaaiListingGetPayload<{ select: typeof IAAI_INDEX_SELECT }>;

const docId = (stock: string) => `iaai_${stock}`;

@Injectable()
export class IaaiIndexService {
  private readonly logger = new Logger(IaaiIndexService.name);
  private ready = false;

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
    const res = await this.openSearch.bulkIndex(
      IAAI_INDEX_NAME,
      active.map((r) => ({ id: docId(r.stockNumber), body: this.toDocument(r) })),
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
    return done;
  }

  /** One IAAI lot in the unified auction document shape (the Copart one). */
  toDocument(r: Row): UnifiedAuction {
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
      makeCanonical: normalizeToken(r.make),
      modelCanonical: normalizeToken(r.model),
      trimCanonical: normalizeToken(r.series),
      colorCanonical: normalizeToken(r.color),
      engine: r.engineSize,
      transmission: r.transmission,
      fuelType: r.fuelType,
      drivetrain: r.drivelineType,
      cylinders: r.cylinders,
      odometer: r.odometer,
      odometerBrand: r.odometerStatus,
      locationCity: r.locationCity,
      locationState: r.locationState,
      locationZip: r.locationZip,
      locationCountry: 'US',
      images: gallery.map((g) => g.thumbnail),
      mainImage: gallery[0]?.thumbnail ?? null,
      createdAt: r.firstSeenAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      indexedAt: new Date().toISOString(),
      damageDescription: r.primaryDamage,
      secondaryDamage: r.secondaryDamage,
      ...sale,
      // The index maps this as a date and Copart writes YYYY-MM-DD.
      saleDateFormatted: sale.saleDate ? `${String(sale.saleDate).slice(0, 4)}-${String(sale.saleDate).slice(4, 6)}-${String(sale.saleDate).slice(6, 8)}` : null,
      saleStatus: r.vehicleStatus,
      saleTitleState: r.certState,
      saleTitleType: r.saleDocument,
      hasKeys: r.keys === 'PRESENT' ? 'YES' : r.keys ? 'NO' : null,
      runsDrives: r.runAndDrive ? 'Run & Drive' : r.startCode,
      lotCondCode: r.startCode,
      wholesale: null,
      saleLight: null,
      highBid: r.currentBid,
      buyItNowPrice: r.buyNowPrice,
      estRetailValue: r.acv,
      repairCost: r.repairCost,
      yardName: r.branchName,
      yardNumber: r.branchCode,
      itemNumber: null,
      sellerName: r.seller,
      sellerCategory: null,
      engineSizeL: parseEngineSizeL(r.engineSize),
      geoPoint: geo ? { lat: geo.lat, lon: geo.lon } : null,
      vectorPca: null,
      discarded: false,
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
