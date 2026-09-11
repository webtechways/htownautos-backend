import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { parse as csvParse } from 'csv-parse';
import { PrismaService } from '@htownautos/prisma';
import { ChatNotifierService } from './chat-notifier.service';
import { AuctionSyncService } from '@htownautos/opensearch';
import {
  deriveSellerCategory,
  parseEngineSizeL,
  geocodeZip,
  canonicalize,
} from '@htownautos/common';
import { WantedMatchNotifierService } from './wanted-match-notifier.service';
import { SellerClassificationNotifierService } from './seller-classification-notifier.service';
import { AuctionAliasNotifierService } from './auction-alias-notifier.service';
import { ImageCacheEnqueuerService } from './image-cache-enqueuer.service';
import { loadAliasMaps } from './alias-maps.util';

// Maps CSV header names → staging column names
const CSV_HEADER_MAP: Record<string, string> = {
  'Id':                          'copartId',
  'Yard number':                 'yardNumber',
  'Yard name':                   'yardName',
  'Sale Date M/D/CY':            'saleDate',
  'Day of Week':                 'dayOfWeek',
  'Sale time (HHMM)':            'saleTime',
  'Time Zone':                   'timeZone',
  'Item#':                       'itemNumber',
  'Lot number':                  'lotNumber',
  'Vehicle Type':                'vehicleType',
  'Year':                        'year',
  'Make':                        'make',
  'Model Group':                 'modelGroup',
  'Model Detail':                'modelDetail',
  'Body Style':                  'bodyStyle',
  'Color':                       'color',
  'Damage Description':          'damageDescription',
  'Secondary Damage':            'secondaryDamage',
  'Sale Title State':            'saleTitleState',
  'Sale Title Type':             'saleTitleType',
  'Has Keys-Yes or No':          'hasKeys',
  'Lot Cond. Code':              'lotCondCode',
  'VIN':                         'vin',
  'Odometer':                    'odometer',
  'Odometer Brand':              'odometerBrand',
  'Est. Retail Value':           'estRetailValue',
  'Repair cost':                 'repairCost',
  'Engine':                      'engine',
  'Drive':                       'drive',
  'Transmission':                'transmission',
  'Fuel Type':                   'fuelType',
  'Cylinders':                   'cylinders',
  'Runs/Drives':                 'runsDrives',
  'Sale Status':                 'saleStatus',
  'High Bid =non-vix,Sealed=Vix':'highBid',
  'Special Note':                'specialNote',
  'Location city':               'locationCity',
  'Location state':              'locationState',
  'Location ZIP':                'locationZip',
  'Location country':            'locationCountry',
  'Currency Code':               'currencyCode',
  'Image Thumbnail':             'imageThumbnail',
  'Create Date/Time':            'createDateTime',
  'Grid/Row':                    'gridRow',
  'Make-an-Offer Eligible':      'makeOfferEligible',
  'Buy-It-Now Price':            'buyItNowPrice',
  'Image URL':                   'imageUrl',
  'Trim':                        'trim',
  'Last Updated Time':           'lastUpdatedTime',
  'Rentals':                     'rentals',
  'Wholesale':                   'wholesale',
  'Seller Name':                 'sellerName',
  'Offsite Address1':            'offsiteAddress1',
  'Offsite State':               'offsiteState',
  'Offsite City':                'offsiteCity',
  'Offsite Zip':                 'offsiteZip',
  'Sale Light':                  'saleLight',
  'AutoGrade':                   'autoGrade',
  'Announcements':               'announcements',
};

const STAGING_COLUMNS = Object.values(CSV_HEADER_MAP);
const BATCH_SIZE = 500;

// ── Resilience tuning knobs ─────────────────────────────────────────────
const DOWNLOAD_TIMEOUT_MS = 90_000;          // 90s per attempt
const DOWNLOAD_MAX_ATTEMPTS = 4;             // total tries (1 + 3 retries)
const DOWNLOAD_BACKOFF_BASE_MS = 2_000;      // 2s, then 4s, 8s, 16s…
const MIN_ROWS_SANITY = 1_000;               // feed below this is clearly broken
const STALENESS_THRESHOLD_HOURS = 6;         // unseen lots become "stale" after 6h
const REQUIRED_HEADERS = ['lotNumber', 'vin', 'make', 'year'] as const;

// Above this many brand-new lots in a single run we skip wanted-match
// notifications: it's almost certainly an initial load or a recreate, and
// matching/notifying tens of thousands of lots would flood the notification
// center. Normal incremental runs add at most a few hundred new lots.
const NEW_LOT_NOTIFY_LIMIT = 5_000;

/** pg_try_advisory_lock key — constant hash of "copart_sync". */
const LOCK_KEY_SQL = `hashtext('copart_sync')`;

interface SyncMetrics {
  bytesDownloaded: number | null;
  rowsParsed: number;
  rowsValid: number;
  rowsInvalid: number;
  rowsUpserted: number;
  rowsStaleMarked: number;
  rowsIndexed: number;
  rowsIndexFailed: number;
}

function makeEmptyMetrics(): SyncMetrics {
  return {
    bytesDownloaded: null,
    rowsParsed: 0,
    rowsValid: 0,
    rowsInvalid: 0,
    rowsUpserted: 0,
    rowsStaleMarked: 0,
    rowsIndexed: 0,
    rowsIndexFailed: 0,
  };
}

@Injectable()
export class CopartImportService implements OnModuleInit {
  /**
   * On worker startup, fail any leftover "running" SyncRun rows. If the worker
   * is (re)starting, any run still flagged running is from a previous process
   * that died/hung mid-sync — otherwise its zombie row makes the dashboard show
   * "Syncing… 0%" forever and (via the advisory lock pattern) could block new
   * runs. Best-effort; never blocks boot.
   */
  async onModuleInit(): Promise<void> {
    try {
      const res = await this.prisma.syncRun.updateMany({
        where: { status: 'running' },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          error: 'Marked failed on worker startup (orphaned/incomplete run)',
        },
      });
      if (res.count > 0) {
        this.logger.warn(`Reconciled ${res.count} orphaned "running" SyncRun row(s) on startup`);
      }
    } catch (e) {
      this.logger.warn(`Startup SyncRun reconciliation failed (non-fatal): ${(e as Error).message}`);
    }
  }

  private readonly logger = new Logger(CopartImportService.name);
  private readonly pool: Pool;

  /** ID of the currently-running SyncRun row; null when idle. */
  private activeSyncRunId: string | null = null;
  /** Last progress integer (0-100) written to DB — used to throttle writes. */
  private lastWrittenProgress = -1;
  /** Timestamp (ms) of the last progress DB write. */
  private lastProgressWriteTs = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly syncService: AuctionSyncService,
    private readonly wantedMatchNotifier: WantedMatchNotifierService,
    private readonly sellerClassificationNotifier: SellerClassificationNotifierService,
    private readonly auctionAliasNotifier: AuctionAliasNotifierService,
    private readonly imageCacheEnqueuer: ImageCacheEnqueuerService,
    private readonly chat: ChatNotifierService,
  ) {
    this.pool = new Pool({
      connectionString: this.configService.get<string>('DATABASE_URL'),
    });
  }

  /**
   * Best-effort progress update. Never throws — a DB hiccup must never abort
   * the sync. Throttled: only writes when the integer % changed AND at least
   * 1 second has elapsed since the last write (or phase changed).
   */
  private async updateProgress(
    phase: string,
    progress: number,
    extra?: { processedRows?: number; totalRows?: number },
  ): Promise<void> {
    const id = this.activeSyncRunId;
    if (!id) return;

    const intProgress = Math.min(100, Math.max(0, Math.round(progress)));
    const now = Date.now();
    const phaseChanged = phase !== this._lastPhase;
    const progressChanged = intProgress !== this.lastWrittenProgress;
    const enoughTimeElapsed = now - this.lastProgressWriteTs >= 1_000;

    if (!phaseChanged && !progressChanged && !enoughTimeElapsed) return;

    this._lastPhase = phase;
    this.lastWrittenProgress = intProgress;
    this.lastProgressWriteTs = now;

    try {
      await this.prisma.syncRun.update({
        where: { id },
        data: {
          phase,
          progress: intProgress,
          ...(extra?.processedRows !== undefined ? { processedRows: extra.processedRows } : {}),
          ...(extra?.totalRows !== undefined ? { totalRows: extra.totalRows } : {}),
        },
      });
    } catch (err) {
      const e = err as Error;
      this.logger.warn(`Progress update failed (non-fatal): ${e?.message}`);
    }
  }

  /** Tracks the last phase string to detect phase changes for throttle bypass. */
  private _lastPhase = '';

  /**
   * Notify dashboard staff that a Copart sync failed, with the reason.
   * data-sync writes Notification rows directly via Prisma (it shares the DB
   * with the api). Best-effort — never throws. Targets the main HtownAutos
   * tenant (override via SYNC_FAILURE_NOTIFY_TENANT_ID).
   */
  private async notifySyncFailure(reason: string): Promise<void> {
    try {
      const tenantId =
        process.env.SYNC_FAILURE_NOTIFY_TENANT_ID ||
        '50197477-9e89-4465-bed5-99c638c435a0'; // HtownAutos main tenant (PORTAL_TENANT_ID)
      const staff = await this.prisma.tenantUser.findMany({
        where: { tenantId, status: 'active', isActive: true },
        select: { userId: true },
      });
      const userIds = [...new Set(staff.map((s) => s.userId))];
      if (userIds.length === 0) return;
      const cleanReason = (reason || 'Motivo desconocido').replace(/\s+/g, ' ').trim().slice(0, 300);
      await this.chat.send({
        tenantId,
        type: 'SYNC_FAILED',
        title: 'Sincronización de Copart falló',
        message: `La sincronización no se completó: ${cleanReason}`,
        priority: 'high',
        actionUrl: '/dashboard/auction',
      });
      await this.prisma.notification.createMany({
        data: userIds.map((userId) => ({
          tenantId,
          userId,
          title: 'Sincronización de Copart falló',
          message: `La sincronización no se completó: ${cleanReason}`,
          type: 'SYNC_FAILED',
          priority: 'high',
          actionUrl: '/dashboard/auction',
          metaValue: { reason: cleanReason, source: 'copart' },
        })),
      });
    } catch (e) {
      this.logger.warn(`Failed to create sync-failure notifications: ${(e as Error).message}`);
    }
  }

  @Cron('9,39 5-22 * * *')
  async handleCopartSyncCron(): Promise<void> {
    await this.runSync();
  }

  /**
   * Top-level orchestrator. Acquires a DB-level advisory lock so two
   * containers (or a manual trigger concurrent with the cron) can't race.
   * Records a SyncRun audit row for every invocation.
   */
  async runSync(): Promise<void> {
    const lockClient = await this.pool.connect();
    let gotLock = false;
    let syncRunId: string | null = null;

    try {
      // 1. Try to acquire the advisory lock (non-blocking)
      const rawLock = await lockClient.query<{ got: boolean }>(
        `SELECT pg_try_advisory_lock(${LOCK_KEY_SQL}) AS got`,
      );
      const lockRes = this.assertSingleResult<{ got: boolean }>(rawLock, 'advisory lock SELECT');
      gotLock = lockRes.rows[0]?.got === true;

      if (!gotLock) {
        this.logger.warn('Copart sync lock held by another worker; logging skipped run');
        await this.prisma.syncRun.create({
          data: {
            source: 'copart',
            status: 'skipped',
            finishedAt: new Date(),
            durationMs: 0,
          },
        });
        return;
      }

      // 2. Open the SyncRun row in "running" state
      const runRow = await this.prisma.syncRun.create({
        data: { source: 'copart', status: 'running', phase: 'downloading', progress: 0 },
      });
      syncRunId = runRow.id;
      this.activeSyncRunId = syncRunId;
      this.lastWrittenProgress = -1;
      this.lastProgressWriteTs = 0;
      this._lastPhase = '';
      const startTs = Date.now();
      const syncStart = runRow.startedAt;

      this.logger.log(`Starting Copart sync (runId=${syncRunId})`);
      const metrics = makeEmptyMetrics();

      try {
        await this.importFromCopartUrl(metrics, syncStart);

        await this.prisma.syncRun.update({
          where: { id: syncRunId },
          data: {
            status: 'success',
            phase: 'done',
            progress: 100,
            finishedAt: new Date(),
            durationMs: Date.now() - startTs,
            ...metrics,
          },
        });
        this.logger.log(
          `Copart sync OK in ${Date.now() - startTs}ms — parsed=${metrics.rowsParsed}, ` +
          `valid=${metrics.rowsValid}, invalid=${metrics.rowsInvalid}, ` +
          `upserted=${metrics.rowsUpserted}, stale=${metrics.rowsStaleMarked}, ` +
          `indexed=${metrics.rowsIndexed}/${metrics.rowsIndexed + metrics.rowsIndexFailed}`,
        );
      } catch (error) {
        const err = error as Error;
        this.logger.error(`Copart sync failed (runId=${syncRunId})`, err?.stack ?? err?.message);
        await this.prisma.syncRun.update({
          where: { id: syncRunId },
          data: {
            status: 'failed',
            finishedAt: new Date(),
            durationMs: Date.now() - startTs,
            error: (err?.message || 'unknown').slice(0, 4000),
            ...metrics,
          },
        });
        // Alert staff in the dashboard that the sync did not complete, with the reason.
        await this.notifySyncFailure(err?.message || 'Motivo desconocido');
      } finally {
        this.activeSyncRunId = null;
      }
    } finally {
      if (gotLock) {
        await lockClient
          .query(`SELECT pg_advisory_unlock(${LOCK_KEY_SQL})`)
          .catch((e: Error) => this.logger.warn(`Failed to release lock: ${e.message}`));
      }
      lockClient.release();
    }
  }

  /**
   * The actual sync pipeline. Mutates `metrics` as it progresses so that
   * even a partial failure leaves trace in the SyncRun row.
   */
  private async importFromCopartUrl(
    metrics: SyncMetrics,
    syncStart: Date,
  ): Promise<void> {
    const url = this.configService.get<string>('COPART_DATA');
    if (!url) throw new Error('COPART_DATA environment variable is not set');

    // Phase: downloading (0→20)
    await this.updateProgress('downloading', 0);
    const csvBuffer = await this.downloadCsvWithRetry(url);
    metrics.bytesDownloaded = csvBuffer.length;
    this.logger.log(`Downloaded ${csvBuffer.length} bytes from Copart`);
    await this.updateProgress('downloading', 20);

    // Phase: parsing (20→45)
    await this.updateProgress('parsing', 20);
    const rows = await this.parseCsv(csvBuffer);
    metrics.rowsParsed = rows.length;
    this.logger.log(`Parsed ${rows.length} rows`);
    await this.updateProgress('parsing', 45, { totalRows: rows.length });

    // Step 3: Sanity-check the parsed result — refuse to truncate if feed looks wrong
    this.assertFeedSanity(rows);

    // Phase: validating (45→55)
    await this.updateProgress('validating', 45);
    const { valid, invalid } = this.validateRows(rows);
    metrics.rowsValid = valid.length;
    metrics.rowsInvalid = invalid;
    if (invalid > 0) {
      this.logger.warn(`Skipped ${invalid} invalid rows (kept ${valid.length})`);
    }
    await this.updateProgress('validating', 55);

    // Phase: saving (55→90) — truncate + stage + upsert
    await this.updateProgress('saving', 55);

    // Step 5: Truncate staging (only after we know the feed is OK)
    await this.truncateStaging();

    // Step 6: Batch INSERT into staging (progress 55→75, updated per batch)
    await this.insertIntoStaging(valid);
    await this.updateProgress('saving', 75, { processedRows: valid.length, totalRows: rows.length });

    // Step 7: Staging → auction_listings (upsert + mark lastSeenAt) (75→88)
    const { total: upserted, newLotNumbers } =
      await this.mapStagingToAuctionListings();
    metrics.rowsUpserted = upserted;
    this.logger.log(
      `Upserted ${upserted} into auction_listings (${newLotNumbers.length} brand-new lots)`,
    );
    await this.updateProgress('saving', 88);

    // Step 7b: Notify staff about brand-new lots that match a buyer's wanted
    // list. Guarded against bulk/initial loads (see NEW_LOT_NOTIFY_LIMIT) and
    // wrapped so a notification failure never aborts the sync.
    if (newLotNumbers.length === 0) {
      // nothing new this run
    } else if (newLotNumbers.length > NEW_LOT_NOTIFY_LIMIT) {
      this.logger.warn(
        `Skipping wanted-match notifications: ${newLotNumbers.length} new lots ` +
          `exceeds threshold of ${NEW_LOT_NOTIFY_LIMIT} (treating as bulk/initial load)`,
      );
    } else {
      try {
        const created = await this.wantedMatchNotifier.notifyNewListings(
          newLotNumbers,
        );
        if (created > 0) {
          this.logger.log(`Created ${created} wanted-match notification(s)`);
        }
      } catch (err) {
        const e = err as Error;
        this.logger.error(
          `Wanted-match notification step failed (non-fatal): ${e?.message}`,
          e?.stack,
        );
      }
    }

    // Step 7b.2: Enqueue brand-new lots for proactive image caching. Uncontrolled
    // by design (only the crawler is rate-limited); non-fatal. Unlike wanted-match
    // this has no bulk guard — flooding the queue is harmless and the backfill
    // seeder would pick these up anyway.
    if (newLotNumbers.length > 0) {
      try {
        const enqueued = await this.imageCacheEnqueuer.enqueueNewLots(newLotNumbers);
        if (enqueued > 0) {
          this.logger.log(`Enqueued ${enqueued} new lot(s) for image caching`);
        }
      } catch (err) {
        this.logger.error(
          `Image-cache enqueue step failed (non-fatal): ${(err as Error)?.message}`,
        );
      }
    }

    // Step 7c: Derive filter attributes (Source / engine size / geo) for lots
    // that don't have them yet. Runs before reindex so OpenSearch picks up the
    // values too. Non-fatal.
    try {
      const derived = await this.deriveAuctionAttributes();
      if (derived > 0) {
        this.logger.log(`Derived filter attributes for ${derived} lot(s)`);
      }
    } catch (err) {
      this.logger.error(
        `Derive-attributes step failed (non-fatal): ${(err as Error)?.message}`,
      );
    }

    // Step 7c.2: Compute canonical make/model/trim/color for new lots (dedupe for
    // facets + matching). Runs before reindex so OpenSearch gets them too. Non-fatal.
    try {
      const canon = await this.canonicalizeListings();
      if (canon > 0) {
        this.logger.log(`Canonicalized filter values for ${canon} lot(s)`);
      }
    } catch (err) {
      this.logger.error(
        `Canonicalize step failed (non-fatal): ${(err as Error)?.message}`,
      );
    }

    // Step 7e: Seed brand-new normalized make/model/trim/color values and notify
    // staff to review/merge them (Settings → Vehicle Data). Non-fatal.
    try {
      await this.auctionAliasNotifier.seedAndNotify();
    } catch (err) {
      this.logger.error(
        `Alias-review step failed (non-fatal): ${(err as Error)?.message}`,
      );
    }

    // Step 7d: Seed brand-new sellers into the classification table and notify
    // staff to classify them (Settings → Sellers). Non-fatal.
    try {
      await this.sellerClassificationNotifier.seedAndNotify();
    } catch (err) {
      this.logger.error(
        `Seller-classification step failed (non-fatal): ${(err as Error)?.message}`,
      );
    }

    // Step 8: Mark as stale any listings not seen in this run (after the grace period)
    metrics.rowsStaleMarked = await this.markStaleListings();
    if (metrics.rowsStaleMarked > 0) {
      this.logger.log(`Marked ${metrics.rowsStaleMarked} listings as stale`);
    }
    await this.updateProgress('saving', 90);

    // Step 9: Truncate staging
    await this.truncateStaging();

    // Phase: indexing (90→100)
    await this.updateProgress('indexing', 90);
    const { success, failed } = await this.syncService.syncAllCopart();
    metrics.rowsIndexed = success;
    metrics.rowsIndexFailed = failed;
    this.logger.log(`OpenSearch: ${success} indexed, ${failed} failed`);
    await this.updateProgress('indexing', 99);

    // Silence unused-param warning; kept for future signature stability.
    void syncStart;
  }

  // ────────────────────────────────────────────────────────────────────
  // Download with timeout + exponential backoff retry
  // ────────────────────────────────────────────────────────────────────

  private async downloadCsvWithRetry(url: string): Promise<Buffer> {
    let lastErr: Error | null = null;
    for (let attempt = 1; attempt <= DOWNLOAD_MAX_ATTEMPTS; attempt++) {
      try {
        return await this.downloadCsvOnce(url, attempt);
      } catch (err) {
        lastErr = err as Error;
        if (attempt === DOWNLOAD_MAX_ATTEMPTS) break;
        const backoff = DOWNLOAD_BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
        this.logger.warn(
          `Download attempt ${attempt}/${DOWNLOAD_MAX_ATTEMPTS} failed: ${lastErr.message}. Retrying in ${backoff}ms`,
        );
        await this.sleep(backoff);
      }
    }
    throw new Error(
      `Copart download failed after ${DOWNLOAD_MAX_ATTEMPTS} attempts: ${lastErr?.message}`,
    );
  }

  private async downloadCsvOnce(url: string, attempt: number): Promise<Buffer> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      this.logger.log(`Downloading Copart CSV (attempt ${attempt}/${DOWNLOAD_MAX_ATTEMPTS})`);
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      // Stream the body so the progress bar advances 0→20% during the ~88MB
      // download (otherwise it sits at 0% for the whole download and looks
      // frozen). Falls back to a single buffer if the body isn't streamable.
      const total = Number(response.headers.get('content-length')) || 0;
      const body = response.body;
      if (!body || typeof (body as ReadableStream).getReader !== 'function') {
        const buf = Buffer.from(await response.arrayBuffer());
        if (buf.length === 0) throw new Error('Empty response body');
        return buf;
      }
      const reader = (body as ReadableStream<Uint8Array>).getReader();
      const chunks: Buffer[] = [];
      let received = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(Buffer.from(value));
          received += value.length;
          if (total > 0) {
            // Download occupies the 0→20 band of the overall progress.
            await this.updateProgress(
              'downloading',
              Math.min(20, Math.round((received / total) * 20)),
            );
          }
        }
      }
      const buf = Buffer.concat(chunks);
      if (buf.length === 0) {
        throw new Error('Empty response body');
      }
      return buf;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Parsing + sanity checks
  // ────────────────────────────────────────────────────────────────────

  private parseCsv(csvBuffer: Buffer): Promise<Record<string, string>[]> {
    return new Promise((resolve, reject) => {
      const rows: Record<string, string>[] = [];

      const parser = csvParse({
        // Map raw header names to internal column names on the fly.
        // Unknown headers pass through as-is so we don't silently lose columns.
        columns: (rawHeaders: string[]) =>
          rawHeaders.map((h) => CSV_HEADER_MAP[h.trim()] ?? h.trim()),
        // Tolerant quoting: csv-parser's default strict mode breaks on
        // Copart's unescaped internal quotes (e.g. "5\" lift kit"). This
        // option makes the parser recover gracefully instead of desyncing.
        relax_quotes: true,
        // Copart rows occasionally have more or fewer fields than the header.
        // Without this, csv-parse throws on those rows. With it, short rows
        // are padded with undefined and long rows have extras discarded.
        relax_column_count: true,
        // Skip any record that still fails to parse after relaxation, rather
        // than rejecting the entire buffer.
        skip_records_with_error: true,
        // Strip a leading UTF-8 BOM if present.
        bom: true,
        // NOTE: do NOT enable csv-parse's `trim` option. On the real Copart
        // feed it interacts with relax_quotes on the ~10 unbalanced-quote rows
        // and collapses 140k rows down to ~4k (verified). Trim per-value in
        // `cast` instead, which runs after a field is extracted and is safe.
        // Cast all values to trimmed strings (pipeline expects Record<string,string>).
        cast: (value: string) => (value ?? '').trim(),
      });

      parser.on('readable', () => {
        let record: Record<string, string> | null;
        // eslint-disable-next-line no-cond-assign
        while ((record = parser.read() as Record<string, string> | null) !== null) {
          rows.push(record);
        }
      });

      parser.on('error', (err: Error) => {
        // Individual record errors are swallowed by skip_records_with_error;
        // a top-level error here means the stream itself is broken.
        this.logger.warn(`csv-parse stream error (skipping): ${err.message}`);
        // Do NOT reject — emit what we have so the sanity check can run and
        // produce a clear message if we got too few rows.
      });

      parser.on('end', () => resolve(rows));

      parser.write(csvBuffer);
      parser.end();
    });
  }

  /** Aborts the run if the parsed feed looks wrong (tiny / missing columns). */
  private assertFeedSanity(rows: Record<string, string>[]): void {
    if (rows.length < MIN_ROWS_SANITY) {
      throw new Error(
        `Feed sanity failed: parsed ${rows.length} rows but expected >=${MIN_ROWS_SANITY}. ` +
          `Refusing to sync to avoid wiping good data.`,
      );
    }
    const firstRow = rows[0];
    const missing = REQUIRED_HEADERS.filter((h) => !(h in firstRow));
    if (missing.length > 0) {
      throw new Error(
        `Feed sanity failed: CSV is missing required columns: ${missing.join(', ')}. ` +
          `Copart may have changed its schema.`,
      );
    }
  }

  /** Drops rows that can't possibly upsert (invalid/missing lotNumber). */
  private validateRows(rows: Record<string, string>[]): {
    valid: Record<string, string>[];
    invalid: number;
  } {
    const valid: Record<string, string>[] = [];
    let invalid = 0;
    for (const row of rows) {
      const raw = (row['lotNumber'] ?? '').trim();
      // Positive integer only; Copart sometimes has blank or textual placeholder rows
      if (!/^\d+$/.test(raw)) {
        invalid++;
        continue;
      }
      valid.push(row);
    }
    return { valid, invalid };
  }

  // ────────────────────────────────────────────────────────────────────
  // Staging + upsert
  // ────────────────────────────────────────────────────────────────────

  private async insertIntoStaging(rows: Record<string, string>[]): Promise<number> {
    if (rows.length === 0) return 0;

    const client = await this.pool.connect();
    let total = 0;

    try {
      // 20-minute per-statement timeout prevents a hung INSERT batch from
      // keeping the run in "running" state indefinitely.
      await client.query("SET statement_timeout = '1200000'");

      const colList = STAGING_COLUMNS.map((c) => `"${c}"`).join(', ');

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const valuePlaceholders: string[] = [];
        const values: (string | null)[] = [];
        let paramIdx = 1;

        for (const row of batch) {
          const rowPlaceholders = STAGING_COLUMNS.map(() => `$${paramIdx++}`);
          valuePlaceholders.push(`(${rowPlaceholders.join(', ')})`);
          for (const col of STAGING_COLUMNS) {
            values.push(row[col] ?? null);
          }
        }

        const sql = `INSERT INTO copart_staging (${colList}) VALUES ${valuePlaceholders.join(', ')}`;
        await client.query(sql, values);
        total += batch.length;
        // Advance the bar through the 55→75 band as rows are staged (throttled).
        await this.updateProgress(
          'saving',
          55 + Math.round((total / rows.length) * 20),
          { processedRows: total, totalRows: rows.length },
        );
      }
      this.logger.log(`Staged ${total} rows`);
    } finally {
      client.release();
    }

    return total;
  }

  /**
   * Guard: throws a clear error if `query.result` is an array (i.e. the caller
   * accidentally passed a multi-statement query string). pg when running a
   * simple multi-statement query returns QueryResult[], not QueryResult, so
   * `.rows` on the array is undefined — the root cause of the June 2026 outage.
   * Call this on EVERY place that reads .rows / .rowCount from a client.query()
   * result so any future regression fails loudly at the source.
   */
  private assertSingleResult<T extends QueryResultRow>(
    result: unknown,
    label: string,
  ): QueryResult<T> {
    if (Array.isArray(result)) {
      throw new Error(
        `Multi-statement query in ${label} returned an array; split it into ` +
          `single statements. This is a programmer error — each client.query() ` +
          `call must contain exactly one SQL statement.`,
      );
    }
    return result as QueryResult<T>;
  }

  private async mapStagingToAuctionListings(): Promise<{
    total: number;
    newLotNumbers: string[];
  }> {
    const client = await this.pool.connect();
    try {
      // Set per-session statement_timeout to prevent a single hung query from
      // holding the sync in "running" state for days. 20 minutes is generous
      // for any single statement; a real hang will exceed this and throw,
      // letting the outer catch mark the run "failed" and notify staff.
      await client.query("SET statement_timeout = '1200000'");

      // STEP 1: Create the helper function. Must be its own round-trip so that
      // node-postgres returns a single QueryResult, not an array.
      // pg_temp functions are session-scoped — the INSERT below on the same
      // client/session will still see this function.
      await client.query(`
        CREATE OR REPLACE FUNCTION pg_temp.safe_numeric(val text, max_int_digits int DEFAULT 10) RETURNS numeric AS $$
        DECLARE
          cleaned  text;
          int_part text;
        BEGIN
          cleaned := REGEXP_REPLACE(TRIM(COALESCE(val, '')), '[^0-9.]', '', 'g');
          cleaned := REGEXP_REPLACE(cleaned, '^\\.+|\\.+$', '', 'g');
          IF cleaned ~ '\\.' AND LENGTH(cleaned) - LENGTH(REPLACE(cleaned, '.', '')) > 1 THEN
            cleaned := REPLACE(cleaned, '.', '');
          END IF;
          IF cleaned = '' THEN RETURN NULL; END IF;
          int_part := SPLIT_PART(cleaned, '.', 1);
          IF LENGTH(int_part) > max_int_digits THEN
            RETURN NULL;
          END IF;
          RETURN cleaned::numeric;
        EXCEPTION WHEN OTHERS THEN
          RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
      `);

      // STEP 2: Run the INSERT as a separate single-statement query.
      // Now result is a plain QueryResult<T>, not QueryResult<T>[].
      const rawInsert = await client.query<{ lotNumber: string; inserted: boolean }>(`
        INSERT INTO auction_listings (
          "auctionName", "copartId", "yardNumber", "yardName", "saleDate",
          "dayOfWeek", "saleTime", "timeZone", "itemNumber", "lotNumber",
          "vehicleType", "year", "make", "modelGroup", "modelDetail",
          "bodyStyle", "color", "damageDescription", "secondaryDamage",
          "saleTitleState", "saleTitleType", "hasKeys", "lotCondCode",
          "vin", "odometer", "odometerBrand", "estRetailValue", "repairCost",
          "engine", "drive", "transmission", "fuelType", "cylinders",
          "runsDrives", "saleStatus", "highBid", "specialNote",
          "locationCity", "locationState", "locationZip", "locationCountry",
          "currencyCode", "images", "createDateTime", "gridRow",
          "makeOfferEligible", "buyItNowPrice", "trim", "lastUpdatedTime",
          "rentals", "wholesale", "sellerName", "offsiteAddress1",
          "offsiteState", "offsiteCity", "offsiteZip", "saleLight",
          "autoGrade", "announcements", "lastSeenAt", "isStale",
          "createdAt", "updatedAt"
        )
        SELECT
          'Copart',
          NULLIF(TRIM("copartId"), '')::integer,
          NULLIF(TRIM("yardNumber"), '')::integer,
          NULLIF(TRIM("yardName"), ''),
          CASE
            -- YYYYMMDD integer (e.g. 20260227)
            WHEN TRIM("saleDate") ~ '^\\d{8}$' AND TRIM("saleDate")::bigint > 20000000 THEN
              TRIM("saleDate")::integer
            -- M/D/YYYY with slashes
            WHEN TRIM("saleDate") ~ '^\\d{1,2}/\\d{1,2}/\\d{4}$' THEN
              (SPLIT_PART(TRIM("saleDate"), '/', 3) ||
               LPAD(SPLIT_PART(TRIM("saleDate"), '/', 1), 2, '0') ||
               LPAD(SPLIT_PART(TRIM("saleDate"), '/', 2), 2, '0'))::integer
            ELSE NULL
          END,
          NULLIF(TRIM("dayOfWeek"), ''),
          NULLIF(TRIM("saleTime"), ''),
          NULLIF(TRIM("timeZone"), ''),
          NULLIF(TRIM("itemNumber"), '')::integer,
          TRIM("lotNumber")::bigint,
          NULLIF(TRIM("vehicleType"), ''),
          NULLIF(TRIM("year"), '')::integer,
          NULLIF(TRIM("make"), ''),
          NULLIF(TRIM("modelGroup"), ''),
          NULLIF(TRIM("modelDetail"), ''),
          NULLIF(TRIM("bodyStyle"), ''),
          NULLIF(TRIM("color"), ''),
          NULLIF(TRIM("damageDescription"), ''),
          NULLIF(TRIM("secondaryDamage"), ''),
          NULLIF(TRIM("saleTitleState"), ''),
          NULLIF(TRIM("saleTitleType"), ''),
          NULLIF(TRIM("hasKeys"), ''),
          NULLIF(TRIM("lotCondCode"), ''),
          NULLIF(TRIM("vin"), ''),
          pg_temp.safe_numeric("odometer", 11),       -- Decimal(12,1) → 11 int digits
          NULLIF(TRIM("odometerBrand"), ''),
          pg_temp.safe_numeric("estRetailValue", 10), -- Decimal(12,2) → 10 int digits
          pg_temp.safe_numeric("repairCost", 10),     -- Decimal(12,2)
          NULLIF(TRIM("engine"), ''),
          NULLIF(TRIM("drive"), ''),
          NULLIF(TRIM("transmission"), ''),
          NULLIF(TRIM("fuelType"), ''),
          NULLIF(TRIM("cylinders"), ''),
          NULLIF(TRIM("runsDrives"), ''),
          NULLIF(TRIM("saleStatus"), ''),
          pg_temp.safe_numeric("highBid", 10),         -- Decimal(12,2)
          NULLIF(TRIM("specialNote"), ''),
          NULLIF(TRIM("locationCity"), ''),
          NULLIF(TRIM("locationState"), ''),
          NULLIF(TRIM("locationZip"), ''),
          NULLIF(TRIM("locationCountry"), ''),
          NULLIF(TRIM("currencyCode"), ''),
          NULLIF(TRIM("imageThumbnail"), ''),
          NULLIF(TRIM("createDateTime"), ''),
          NULLIF(TRIM("gridRow"), ''),
          NULLIF(TRIM("makeOfferEligible"), ''),
          pg_temp.safe_numeric("buyItNowPrice", 10),  -- Decimal(12,2)
          NULLIF(TRIM("trim"), ''),
          NOW(),
          NULLIF(TRIM("rentals"), ''),
          NULLIF(TRIM("wholesale"), ''),
          NULLIF(TRIM("sellerName"), ''),
          NULLIF(TRIM("offsiteAddress1"), ''),
          NULLIF(TRIM("offsiteState"), ''),
          NULLIF(TRIM("offsiteCity"), ''),
          NULLIF(TRIM("offsiteZip"), ''),
          NULLIF(TRIM("saleLight"), ''),
          NULLIF(TRIM("autoGrade"), ''),
          NULLIF(TRIM("announcements"), ''),
          NOW(),  -- lastSeenAt
          false,  -- isStale
          NOW(),
          NOW()
        FROM (
          SELECT DISTINCT ON (TRIM("lotNumber")) *
          FROM copart_staging
          WHERE NULLIF(TRIM("lotNumber"), '') IS NOT NULL
            AND TRIM("lotNumber") ~ '^[0-9]+$'
          ORDER BY TRIM("lotNumber"), ctid DESC
        ) AS copart_staging
        ON CONFLICT ("lotNumber") DO UPDATE SET
          "auctionName"       = EXCLUDED."auctionName",
          "yardNumber"        = EXCLUDED."yardNumber",
          "yardName"          = EXCLUDED."yardName",
          "saleDate"          = EXCLUDED."saleDate",
          "dayOfWeek"         = EXCLUDED."dayOfWeek",
          "saleTime"          = EXCLUDED."saleTime",
          "timeZone"          = EXCLUDED."timeZone",
          "itemNumber"        = EXCLUDED."itemNumber",
          "vehicleType"       = EXCLUDED."vehicleType",
          "year"              = EXCLUDED."year",
          "make"              = EXCLUDED."make",
          "modelGroup"        = EXCLUDED."modelGroup",
          "modelDetail"       = EXCLUDED."modelDetail",
          "bodyStyle"         = EXCLUDED."bodyStyle",
          "color"             = EXCLUDED."color",
          "damageDescription" = EXCLUDED."damageDescription",
          "secondaryDamage"   = EXCLUDED."secondaryDamage",
          "saleTitleState"    = EXCLUDED."saleTitleState",
          "saleTitleType"     = EXCLUDED."saleTitleType",
          "hasKeys"           = EXCLUDED."hasKeys",
          "lotCondCode"       = EXCLUDED."lotCondCode",
          "vin"               = EXCLUDED."vin",
          "odometer"          = EXCLUDED."odometer",
          "odometerBrand"     = EXCLUDED."odometerBrand",
          "estRetailValue"    = EXCLUDED."estRetailValue",
          "repairCost"        = EXCLUDED."repairCost",
          "engine"            = EXCLUDED."engine",
          "drive"             = EXCLUDED."drive",
          "transmission"      = EXCLUDED."transmission",
          "fuelType"          = EXCLUDED."fuelType",
          "cylinders"         = EXCLUDED."cylinders",
          "runsDrives"        = EXCLUDED."runsDrives",
          "saleStatus"        = EXCLUDED."saleStatus",
          "highBid"           = EXCLUDED."highBid",
          "specialNote"       = EXCLUDED."specialNote",
          "locationCity"      = EXCLUDED."locationCity",
          "locationState"     = EXCLUDED."locationState",
          "locationZip"       = EXCLUDED."locationZip",
          "locationCountry"   = EXCLUDED."locationCountry",
          "currencyCode"      = EXCLUDED."currencyCode",
          "images"            = EXCLUDED."images",
          "createDateTime"    = EXCLUDED."createDateTime",
          "gridRow"           = EXCLUDED."gridRow",
          "makeOfferEligible" = EXCLUDED."makeOfferEligible",
          "buyItNowPrice"     = EXCLUDED."buyItNowPrice",
          "trim"              = EXCLUDED."trim",
          "lastUpdatedTime"   = NOW(),
          "rentals"           = EXCLUDED."rentals",
          "wholesale"         = EXCLUDED."wholesale",
          "sellerName"        = EXCLUDED."sellerName",
          "offsiteAddress1"   = EXCLUDED."offsiteAddress1",
          "offsiteState"      = EXCLUDED."offsiteState",
          "offsiteCity"       = EXCLUDED."offsiteCity",
          "offsiteZip"        = EXCLUDED."offsiteZip",
          "saleLight"         = EXCLUDED."saleLight",
          "autoGrade"         = EXCLUDED."autoGrade",
          "announcements"     = EXCLUDED."announcements",
          -- A lot reappearing in the feed is de-facto fresh again
          "lastSeenAt"        = NOW(),
          "isStale"           = false,
          "updatedAt"         = NOW()
        -- xmax = 0 on a row touched by INSERT ... ON CONFLICT means it was
        -- freshly INSERTED (not updated): the hook for "a brand-new lot".
        RETURNING "lotNumber"::text AS "lotNumber", (xmax = 0) AS inserted
      `);

      // assertSingleResult guards against the multi-statement footgun that
      // caused the June 2026 outage. With the CREATE FUNCTION now split into its
      // own call above, this should always be a no-op — but if someone ever
      // merges a multi-statement string here again the error will be explicit.
      const insertResult = this.assertSingleResult<{
        lotNumber: string;
        inserted: boolean;
      }>(rawInsert, 'mapStagingToAuctionListings INSERT');

      const newLotNumbers = insertResult.rows
        .filter((r) => r.inserted)
        .map((r) => r.lotNumber);

      return { total: insertResult.rowCount ?? 0, newLotNumbers };
    } finally {
      client.release();
    }
  }

  /**
   * Mark as stale any Copart listing whose lastSeenAt is older than the
   * threshold (and wasn't already flagged). This catches both lots sold/
   * removed from Copart's inventory and pre-existing listings that never
   * had lastSeenAt populated (migrated data).
   */
  private async markStaleListings(): Promise<number> {
    const client = await this.pool.connect();
    try {
      // 20-minute per-statement timeout; an UPDATE on 100k rows should never
      // take anywhere near this long under normal conditions.
      await client.query("SET statement_timeout = '1200000'");

      const rawResult = await client.query(
        `
        UPDATE auction_listings
        SET "isStale" = true, "updatedAt" = NOW()
        WHERE "auctionName" = 'Copart'
          AND "isStale" = false
          AND (
            "lastSeenAt" IS NULL
            OR "lastSeenAt" < NOW() - INTERVAL '${STALENESS_THRESHOLD_HOURS} hours'
          )
        `,
      );
      const result = this.assertSingleResult(rawResult, 'markStaleListings UPDATE');
      return result.rowCount ?? 0;
    } finally {
      client.release();
    }
  }

  /**
   * Derive Source (sellerCategory), engine size (litres) and geo coordinates
   * from the raw feed columns and persist them. Only touches lots that don't
   * have the values yet (new lots each run; the whole table on first pass /
   * via the backfill script). Shared derivation logic lives in
   * `@htownautos/common` so OpenSearch and Postgres stay identical.
   */
  private async deriveAuctionAttributes(): Promise<number> {
    const BATCH = 5000;
    let processed = 0;

    // One bulk `UPDATE ... FROM (VALUES ...)` per batch via the raw pg pool.
    // A Prisma interactive $transaction of thousands of per-row updates blows
    // the 5s transaction timeout; a single statement per batch does not.
    // Keyed on sellerCategory (always set below) so every processed row leaves
    // the predicate on the next pass — the loop always terminates.
    for (;;) {
      const { rows } = await this.pool.query<{
        lotNumber: string;
        engine: string | null;
        rentals: string | null;
        sellerName: string | null;
        locationZip: string | null;
      }>(
        `SELECT "lotNumber", "engine", "rentals", "sellerName", "locationZip"
         FROM auction_listings
         WHERE "auctionName" = 'Copart' AND "sellerCategory" IS NULL
         LIMIT ${BATCH}`,
      );
      if (rows.length === 0) break;

      const values: string[] = [];
      const params: Array<string | number | null> = [];
      let i = 1;
      for (const r of rows) {
        const geo = geocodeZip(r.locationZip);
        const engineSizeL = parseEngineSizeL(r.engine);
        params.push(
          r.lotNumber,
          deriveSellerCategory(r.rentals, r.sellerName),
          engineSizeL,
          geo ? geo.lat : null,
          geo ? geo.lon : null,
        );
        values.push(
          `($${i}::bigint,$${i + 1},$${i + 2}::numeric,$${i + 3}::double precision,$${i + 4}::double precision)`,
        );
        i += 5;
      }

      await this.pool.query(
        `UPDATE auction_listings a
         SET "sellerCategory" = v.cat,
             "engineSizeL"    = v.el,
             "locationLat"    = v.lat,
             "locationLng"    = v.lng
         FROM (VALUES ${values.join(',')}) AS v("lotNumber", cat, el, lat, lng)
         WHERE a."lotNumber" = v."lotNumber"`,
        params,
      );

      processed += rows.length;
      if (rows.length < BATCH) break;
    }

    return processed;
  }

  /**
   * Compute canonical (deduped, UPPERCASE) make/model/trim/color from the raw
   * columns + the staff alias overrides, for lots that don't have them yet (new
   * lots each run; the whole table via the migration's deterministic backfill /
   * the backfill script). Keyed on `makeCanonical IS NULL` (make is required, so
   * it always gets a value) → the loop always terminates. Mirrors
   * deriveAuctionAttributes' batched raw-pool pattern.
   */
  private async canonicalizeListings(): Promise<number> {
    const BATCH = 5000;
    const maps = await loadAliasMaps(this.prisma);
    let processed = 0;

    for (;;) {
      const { rows } = await this.pool.query<{
        lotNumber: string;
        make: string | null;
        modelGroup: string | null;
        trim: string | null;
        color: string | null;
      }>(
        `SELECT "lotNumber", "make", "modelGroup", "trim", "color"
         FROM auction_listings
         WHERE "makeCanonical" IS NULL AND "make" IS NOT NULL
         LIMIT ${BATCH}`,
      );
      if (rows.length === 0) break;

      const values: string[] = [];
      const params: Array<string | null> = [];
      let i = 1;
      for (const r of rows) {
        params.push(
          r.lotNumber,
          canonicalize(r.make, maps.make) ?? '(UNKNOWN)',
          canonicalize(r.modelGroup, maps.model),
          canonicalize(r.trim, maps.trim),
          canonicalize(r.color, maps.color),
        );
        values.push(
          `($${i}::bigint,$${i + 1}::text,$${i + 2}::text,$${i + 3}::text,$${i + 4}::text)`,
        );
        i += 5;
      }

      await this.pool.query(
        `UPDATE auction_listings a
         SET "makeCanonical"  = v.mk,
             "modelCanonical" = v.mo,
             "trimCanonical"  = v.tr,
             "colorCanonical" = v.co
         FROM (VALUES ${values.join(',')}) AS v("lotNumber", mk, mo, tr, co)
         WHERE a."lotNumber" = v."lotNumber"`,
        params,
      );

      processed += rows.length;
      if (rows.length < BATCH) break;
    }

    return processed;
  }

  private async truncateStaging(): Promise<void> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('TRUNCATE TABLE copart_staging RESTART IDENTITY');
    } finally {
      client.release();
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
