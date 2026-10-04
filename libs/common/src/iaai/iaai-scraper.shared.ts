import { createHash } from 'crypto';

/**
 * Shared by the IAAI scraper worker (data-sync) and its control API: how a
 * bidexport.com document maps to an `iaai_listings` row, and when the schedule
 * says a pass should be running.
 */

export const BIDEXPORT_FILTER_URL = 'https://bidexport.com/filter';

/** The parts of the schedule both sides need, as stored in IaaiScraperConfig. */
export interface IaaiSchedule {
  scheduleMode: string;
  windowStart: string;
  windowEnd: string;
  timezone: string;
  daysOfWeek: number[];
  intervalHours: number;
}

const toMin = (hhmm: string): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  return m ? Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2])) : 0;
};

/** Weekday (0 = Sunday) and minute of the day of `date` in `timeZone`. */
export function zonedClock(date: Date, timeZone: string): { weekday: number; minutes: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { weekday, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/**
 * Whether `now` falls in the daily window. A window whose end is before its
 * start crosses midnight (22:00 → 02:00); the day that counts is the one it
 * started on.
 */
export function inIaaiWindow(cfg: IaaiSchedule, now: Date): boolean {
  const { weekday, minutes } = zonedClock(now, cfg.timezone);
  const start = toMin(cfg.windowStart);
  const end = toMin(cfg.windowEnd);
  const days = cfg.daysOfWeek?.length ? cfg.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
  if (start === end) return days.includes(weekday);
  if (start < end) return days.includes(weekday) && minutes >= start && minutes < end;
  if (minutes >= start) return days.includes(weekday);
  return minutes < end && days.includes((weekday + 6) % 7);
}

/**
 * Should a scheduled pass start now? `lastStartedAt` is when the latest
 * scheduled (or manual) pass began.
 */
export function scheduleWantsRun(cfg: IaaiSchedule, now: Date, lastStartedAt: Date | null): boolean {
  const gapMs = Math.max(0, cfg.intervalHours) * 3600_000;
  const gapOk = !lastStartedAt || now.getTime() - lastStartedAt.getTime() >= gapMs;
  if (cfg.scheduleMode === 'interval') return gapOk && gapMs > 0;
  if (cfg.scheduleMode === 'window') return inIaaiWindow(cfg, now) && gapOk;
  return false;
}

/** First minute from `now` (within a week) when a scheduled pass would start. */
export function nextScheduledStart(cfg: IaaiSchedule, now: Date, lastStartedAt: Date | null): Date | null {
  if (cfg.scheduleMode === 'interval') {
    if (cfg.intervalHours <= 0) return null;
    if (!lastStartedAt) return now;
    return new Date(Math.max(now.getTime(), lastStartedAt.getTime() + cfg.intervalHours * 3600_000));
  }
  if (cfg.scheduleMode !== 'window') return null;
  if (scheduleWantsRun(cfg, now, lastStartedAt)) return now;
  const step = 5 * 60_000;
  const end = now.getTime() + 8 * 86400_000;
  for (let t = Math.ceil(now.getTime() / step) * step; t < end; t += step) {
    const d = new Date(t);
    if (scheduleWantsRun(cfg, d, lastStartedAt)) return d;
  }
  return null;
}

// ── Mapping ──────────────────────────────────────────────────────────────────

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
};

const int = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
};

const yesNo = (v: unknown): boolean | null => {
  const s = str(v)?.toLowerCase();
  if (s === 'yes' || s === 'true') return true;
  if (s === 'no' || s === 'false') return false;
  return null;
};

/** `{"0": a, "1": b}` (how bidexport serializes arrays) or a real array → array. */
const listOf = <T>(v: unknown): T[] => {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === 'object') {
    return Object.keys(v as object)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => (v as Record<string, T>)[k]);
  }
  return [];
};

/** "10/07/2026 04:30:00 PM" (UTC) → Date. */
const usDateTimeUtc = (v: unknown): Date | null => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) ([AP]M)$/i.exec(str(v) ?? '');
  if (!m) return null;
  let h = Number(m[4]) % 12;
  if (m[7].toUpperCase() === 'PM') h += 12;
  return new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), h, Number(m[5]), Number(m[6])));
};

const epoch = (v: unknown): Date | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n) : null;
};

export interface IaaiMappedListing {
  stockNumber: string;
  data: Record<string, unknown>;
  imageUrls: string[];
  imageHash: string | null;
}

/**
 * bidexport document → the columns of `iaai_listings`. Returns null for a
 * document without a stock number (nothing to key it on).
 */
export function mapBidexportItem(doc: Record<string, any>): IaaiMappedListing | null {
  const stockNumber = str(doc.StockNumber);
  if (!stockNumber) return null;

  const vin = (doc.Vin ?? {}) as Record<string, unknown>;
  const info: Record<string, unknown> = {};
  for (const e of listOf<{ Name?: string; Value?: unknown }>(doc.AdditionalVehicleInformation)) {
    if (e?.Name) info[e.Name] = e.Value;
  }
  const addr = (doc.AddressofStock ?? {}) as Record<string, unknown>;
  const imageUrls = listOf<string>(doc.ImageURL).map((u) => str(u)).filter((u): u is string => !!u && /^https?:\/\//.test(u));
  const branchCode = int(doc.branchcode);

  // The `…Formated` epochs are local wall-clock time stored as if it were UTC;
  // the Utc* strings and UtcCloseDateFormatted are the real instant.
  const auctionAt = usDateTimeUtc(doc.UtcLiveDate) ?? epoch(doc.UtcCloseDateFormatted);

  const { ImageURL, ImageURLThumbNail, AdditionalVehicleInformation, ...raw } = doc;
  void ImageURL; void ImageURLThumbNail; void AdditionalVehicleInformation;

  const year = int(doc.Year) ?? int(vin.Year);
  return {
    stockNumber,
    imageUrls,
    imageHash: imageUrls.length ? createHash('sha1').update(imageUrls.join('\n')).digest('hex') : null,
    data: {
      externalId: str(doc._id),
      providerId: int(doc.providerId),
      vin: str(vin.ID),
      year: year && year > 1885 && year < 2100 ? year : null,
      make: str(doc.Make) ?? str(vin.Make),
      model: str(doc.Model) ?? str(vin.Model),
      series: str(vin.Series),
      bodyStyle: str(info['Body Style']) ?? str(vin.Body),
      color: str(info['Color']),
      engineSize: str(info['Engine Size']) ?? str(vin.Engine),
      transmission: str(vin.Transmission),
      fuelType: str(vin.FuelType),
      drivelineType: str(vin.DriveLineType),
      cylinders: str(vin.Cylinder),
      vehicleType: str(vin.VehicleType) ?? str(doc.SalvageType),
      odometer: int(doc.mileage) ?? int(doc.Odometer),
      odometerStatus: str(doc.OdomStatus),
      primaryDamage: str(doc.PrimaryDamage),
      secondaryDamage: str(doc.SecondaryDamage),
      lossType: str(doc.LossType),
      saleDocument: str(doc.SaleDocument),
      saleDocumentBrand: str(doc.SaleDocumentBrand),
      certState: str(doc.CertState),
      runAndDrive: yesNo(doc.RunAndDrive),
      startCode: str(doc.Start),
      keys: str(doc.Key) ?? str(info['KeyFob']),
      acv: int(info['ACV']),
      repairCost: int(info['Estimated Repair Cost']),
      currentBid: int(doc.currentBid),
      buyNowPrice: int(doc.stockPrice) || null,
      reservePrice: int(doc.reservePrice?.amount) || null,
      branchCode: branchCode || null,
      branchName: str(doc.BranchName),
      locationAddress: str(addr.Address),
      locationCity: str(addr.City),
      locationState: str(addr.State),
      locationZip: str(addr.Zip),
      seller: str(doc.Seller),
      auctionType: str(doc.AuctionType),
      auctionAt,
      timezone: str(doc.Timezone),
      vehicleStatus: str(doc.VehicleStatus),
      whoCanBuy: str(doc.WhoCanBuy),
      publicAuction: yesNo(doc.PublicAuction),
      sourceCreatedAt: epoch(doc.createdAt),
      imageCount: imageUrls.length,
      raw,
    },
  };
}

// ── Photos ───────────────────────────────────────────────────────────────────

/** IAAI's resizer serves any size of the same photo: `...&width=845&height=633`. */
export function iaaiResize(url: string, width: number, height: number): string {
  if (!/[?&]width=\d+/.test(url)) return url;
  return url.replace(/([?&])width=\d+/, `$1width=${width}`).replace(/([?&])height=\d+/, `$1height=${height}`);
}

/**
 * The scraped photo URLs of an IAAI lot as the image cache's gallery list:
 * the same thumbnail (`thb`) + full size (`hrs`) pair Copart galleries have,
 * so one consumer and one gallery format serve both auctions.
 */
export function iaaiGalleryImages(sourceUrls: unknown): { sequence: number; thumbnail: string; fullSize: string }[] {
  const urls = Array.isArray(sourceUrls) ? sourceUrls.filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u)) : [];
  return urls.map((url, i) => ({ sequence: i + 1, thumbnail: iaaiResize(url, 320, 240), fullSize: url }));
}
