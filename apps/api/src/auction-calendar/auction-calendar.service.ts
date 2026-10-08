import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import {
  CALENDAR_LIVE_HOURS,
  ProxyService,
  copartLaneCodes,
  effectiveCalendarStatus,
  timeStatus,
  type CalendarStatus,
} from '@htownautos/common';
import { UpdateCalendarConfigDto } from './dto/update-calendar-config.dto';
import { UpdateCalendarAlertsDto } from './dto/update-calendar-alerts.dto';

const CONFIG_ID = 'singleton';
const CALENDAR_URL = 'https://www.autobidmaster.com/en/data/v2/auction-calendar';

// Browser-like headers captured from AutoBidMaster's own calendar request.
const BROWSER_HEADERS: Record<string, string> = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.9',
  priority: 'u=1, i',
  referer: 'https://www.autobidmaster.com/en/search/calendar/?view=list&page=1',
  'sec-ch-ua': '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
};

/** Un intento de la sync del calendario, tal como queda en el log. */
interface SyncAttempt {
  n: number;
  /** ip:puerto del proxy (sin credenciales) o `direct`. */
  proxy: string;
  status: number | null;
  ms: number;
  error: string | null;
  at: string;
}

interface AbmLocation {
  sourceId?: number;
  catalogSourceId?: number;
  name?: string;
  slug?: string;
  region?: string | null;
  countryCode?: string | null;
  point?: { latitude?: number; longitude?: number } | null;
}
interface AbmAuction {
  location?: AbmLocation;
  startedAt?: string;
  inventoryAuction?: string;
  auctionGroup?: string;
  locationName?: string;
  totalAvailableItems?: number;
}

@Injectable()
export class AuctionCalendarService implements OnModuleInit {
  private readonly logger = new Logger(AuctionCalendarService.name);
  private fetching = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly proxy: ProxyService,
  ) {}

  async onModuleInit() {
    const cfg = await this.prisma.auctionCalendarConfig.findUnique({ where: { id: CONFIG_ID } });
    if (!cfg?.lastFetchedAt) {
      this.fetchAndStore('boot').catch((e) => this.logger.warn(`[Calendar] Initial fetch failed: ${e.message}`));
    }
  }

  /** Hourly check; refresh when the configured interval has elapsed. */
  @Cron(CronExpression.EVERY_HOUR)
  async autoRefresh() {
    try {
      const cfg = await this.prisma.auctionCalendarConfig.findUnique({ where: { id: CONFIG_ID } });
      const hours = cfg?.refreshHours ?? 6;
      if (hours <= 0) return;
      const last = cfg?.lastFetchedAt;
      if (last && Date.now() - last.getTime() < hours * 3_600_000) return;
      await this.fetchAndStore('cron');
    } catch (err: any) {
      this.logger.error(`[Calendar] Auto-refresh failed: ${err.message}`);
    }
  }

  /**
   * Pide el calendario con reintentos: hasta `maxAttempts` intentos, cada uno
   * por un proxy distinto del pool, esperando `retryDelaySeconds` entre uno y
   * otro. Cada intento queda en `attempts` para el log.
   */
  private async fetchCalendarJson(cfg: { maxAttempts: number; retryDelaySeconds: number }, attempts: SyncAttempt[]): Promise<any> {
    const max = Math.min(Math.max(cfg.maxAttempts || 1, 1), 10);
    const espera = Math.min(Math.max(cfg.retryDelaySeconds ?? 30, 0), 600) * 1000;
    let ultimo = 'sin intentos';
    for (let n = 1; n <= max; n++) {
      const r = await this.proxy.fetchOnce(CALENDAR_URL, { headers: BROWSER_HEADERS });
      const intento: SyncAttempt = { n, proxy: r.proxy, status: r.status, ms: r.ms, error: null, at: new Date().toISOString() };
      attempts.push(intento);
      let json: any = null;
      if (r.error) intento.error = r.error;
      else if (r.status !== 200) intento.error = `HTTP ${r.status}${r.status === 403 ? ' (bloqueado)' : ''}`;
      else {
        try {
          json = JSON.parse(r.body!.toString('utf8'));
        } catch {
          // 200 con HTML: pagina de desafio de Cloudflare
          intento.error = `200 pero no es JSON (${r.contentType ?? 'sin content-type'}): probable desafio`;
        }
      }
      if (json && !intento.error) {
        const root = Array.isArray(json) ? json[0] : json;
        if (root?.auctions && typeof root.auctions === 'object') return json;
        intento.error = 'JSON sin "auctions"';
      }
      ultimo = intento.error!;
      this.logger.warn(`[Calendar] intento ${n}/${max} por ${r.proxy}: ${ultimo}`);
      if (n < max && espera) await new Promise((res) => setTimeout(res, espera));
    }
    throw new Error(`${max} intento(s) fallidos; ultimo: ${ultimo}`);
  }

  /** Fetch the AutoBidMaster calendar, flatten it, and fully replace the table. */
  async fetchAndStore(trigger: 'cron' | 'manual' | 'boot' = 'manual'): Promise<{ count: number; logId?: string; skipped?: boolean }> {
    if (this.fetching) return { count: 0, skipped: true };
    this.fetching = true;
    const t0 = Date.now();
    const attempts: SyncAttempt[] = [];
    const log = await this.prisma.auctionCalendarSyncLog
      .create({ data: { trigger }, select: { id: true } })
      .catch(() => null);
    const cerrarLog = (data: { ok: boolean; count?: number; error?: string }) =>
      log
        ? this.prisma.auctionCalendarSyncLog
            .update({
              where: { id: log.id },
              data: { ...data, finishedAt: new Date(), durationMs: Date.now() - t0, attempts: attempts as unknown as Prisma.InputJsonValue },
            })
            .catch(() => undefined)
        : Promise.resolve();
    try {
      this.logger.log(`[Calendar] Fetching AutoBidMaster auction calendar (${trigger})…`);
      const cfg = await this.getConfig();
      const json = await this.fetchCalendarJson(cfg, attempts);
      const root = Array.isArray(json) ? json[0] : json;
      const auctions = root?.auctions ?? {};

      // Preserve the staff "monitor" toggle, the assigned agent AND the VM that
      // claimed the sale, keyed by (location, startedAt). Without this every
      // refresh (every few hours) would wipe all three — and losing the VM is
      // the worst of the three: the machine would keep its five tabs open while
      // the API hands the same sales to somebody else.
      const previous = await this.prisma.auctionCalendarEntry.findMany({
        where: {
          OR: [
            { monitor: true },
            { scraperAgentId: { not: null } },
            { scraperWorkerId: { not: null } },
            { alertedAt: { not: null } },
            { manualStatus: { not: null } },
            { endedAt: { not: null } },
            { endedLanes: { isEmpty: false } },
          ],
        },
        select: {
          locationSourceId: true,
          startedAt: true,
          monitor: true,
          scraperAgentId: true,
          scraperWorkerId: true,
          alertedAt: true,
          endedLanes: true,
          endedAt: true,
          manualStatus: true,
          manualStatusAt: true,
          manualStatusBy: true,
        },
      });
      const keyOf = (m: { locationSourceId: number; startedAt: Date }) =>
        `${m.locationSourceId}|${m.startedAt.toISOString()}`;
      const monitored = new Set(previous.filter((m) => m.monitor).map(keyOf));
      const assignedAgent = new Map(
        previous.filter((m) => m.scraperAgentId).map((m) => [keyOf(m), m.scraperAgentId as string]),
      );
      const claimedBy = new Map(
        previous
          .filter((m) => m.scraperWorkerId)
          .map((m) => [keyOf(m), m.scraperWorkerId as string]),
      );
      // Si esto no se preservara, cada refresco —cada pocas horas— volveria a
      // avisar de las mismas subastas.
      const alerted = new Map(
        previous.filter((m) => m.alertedAt).map((m) => [keyOf(m), m.alertedAt as Date]),
      );
      // Lo que dijo el socket (ENDAUC) y lo que decidio una persona tampoco se
      // pierde: el calendario de AutoBidMaster no sabe nada de eso.
      const fin = new Map(
        previous
          .filter((m) => m.manualStatus || m.endedAt || m.endedLanes.length)
          .map((m) => [keyOf(m), m]),
      );

      const now = new Date();
      const rows: Prisma.AuctionCalendarEntryCreateManyInput[] = [];
      const seen = new Set<string>();

      for (const status of Object.keys(auctions)) {
        const groups = auctions[status] ?? {};
        for (const group of Object.keys(groups)) {
          for (const a of (groups[group] ?? []) as AbmAuction[]) {
            const loc = a.location ?? {};
            const sourceId = loc.sourceId;
            const slug = loc.slug;
            const startedAtIso = a.startedAt;
            if (sourceId == null || !slug || !startedAtIso) continue;

            const startedAt = new Date(startedAtIso);
            if (isNaN(startedAt.getTime())) continue;

            // Dedupe within the response by (location, startedAt).
            const key = `${sourceId}|${startedAt.toISOString()}`;
            if (seen.has(key)) continue;
            seen.add(key);

            const saleDate = this.centralDate(startedAt);
            const f = fin.get(key);
            rows.push({
              status: f?.manualStatus ?? (f?.endedAt ? 'ended' : status),
              endedLanes: f?.endedLanes ?? [],
              endedAt: f?.endedAt ?? null,
              manualStatus: f?.manualStatus ?? null,
              manualStatusAt: f?.manualStatusAt ?? null,
              manualStatusBy: f?.manualStatusBy ?? null,
              auctionGroup: group,
              locationSourceId: sourceId,
              catalogSourceId: loc.catalogSourceId ?? null,
              locationName: loc.name ?? a.locationName ?? slug,
              locationSlug: slug,
              countryCode: loc.countryCode ?? null,
              region: loc.region ?? null,
              latitude: loc.point?.latitude ?? null,
              longitude: loc.point?.longitude ?? null,
              startedAt,
              saleDate,
              inventoryAuction: a.inventoryAuction ?? null,
              totalAvailableItems: a.totalAvailableItems ?? 0,
              url: this.buildUrl(slug, saleDate),
              monitor: monitored.has(key),
              scraperAgentId: assignedAgent.get(key) ?? null,
              scraperWorkerId: claimedBy.get(key) ?? null,
              alertedAt: alerted.get(key) ?? null,
              raw: a as unknown as Prisma.InputJsonValue,
              fetchedAt: now,
            });
          }
        }
      }

      // Full replace in a transaction.
      await this.prisma.$transaction([
        this.prisma.auctionCalendarEntry.deleteMany({}),
        this.prisma.auctionCalendarEntry.createMany({ data: rows, skipDuplicates: true }),
      ]);
      await this.prisma.auctionCalendarConfig.upsert({
        where: { id: CONFIG_ID },
        update: { lastFetchedAt: now, lastCount: rows.length, lastError: null },
        create: { id: CONFIG_ID, lastFetchedAt: now, lastCount: rows.length },
      });

      this.logger.log(`[Calendar] Stored ${rows.length} auction calendar entries`);
      await cerrarLog({ ok: true, count: rows.length });
      await this.podarLogs();
      return { count: rows.length, logId: log?.id };
    } catch (err: any) {
      await cerrarLog({ ok: false, error: String(err.message).slice(0, 2000) });
      await this.podarLogs();
      await this.prisma.auctionCalendarConfig
        .upsert({
          where: { id: CONFIG_ID },
          update: { lastError: err.message },
          create: { id: CONFIG_ID, lastError: err.message },
        })
        .catch(() => undefined);
      this.logger.error(`[Calendar] Fetch/store failed: ${err.message}`);
      throw err;
    } finally {
      this.fetching = false;
    }
  }

  /** Se guardan las ultimas 300 sincronizaciones (~12 dias a una por hora). */
  private async podarLogs() {
    const corte = await this.prisma.auctionCalendarSyncLog
      .findMany({ orderBy: { startedAt: 'desc' }, skip: 300, take: 1, select: { startedAt: true } })
      .catch(() => []);
    if (corte[0]) {
      await this.prisma.auctionCalendarSyncLog.deleteMany({ where: { startedAt: { lte: corte[0].startedAt } } }).catch(() => undefined);
    }
  }

  /** Ultimas sincronizaciones, la mas reciente primero (para la pantalla del calendario). */
  async syncLogs(limit = 50) {
    const rows = await this.prisma.auctionCalendarSyncLog.findMany({
      orderBy: { startedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 300),
    });
    return { running: this.fetching, data: rows };
  }

  /** YYYYMMDD of the instant in Houston Central time. */
  private centralDate(d: Date): number {
    const s = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
    return parseInt(s.replace(/-/g, ''), 10);
  }

  private buildUrl(slug: string, saleDate: number): string {
    return `https://www.autobidmaster.com/en/search/sale-location-id-${slug}/sale-date-${saleDate}`;
  }

  // ── Read API ────────────────────────────────────────────────────────────────
  async getConfig() {
    const cfg = await this.prisma.auctionCalendarConfig.findUnique({ where: { id: CONFIG_ID } });
    // El respaldo tiene que llevar los mismos campos que la fila real: si no,
    // quien lea `getConfig()` recibe un objeto con menos propiedades el dia que
    // la configuracion aun no existe.
    return (
      cfg ?? {
        id: CONFIG_ID,
        refreshHours: 6,
        maxAttempts: 4,
        retryDelaySeconds: 30,
        lastFetchedAt: null,
        lastError: null,
        lastCount: 0,
        alertsEnabled: false,
        alertMinutesBefore: 30,
        alertChannelIds: [] as string[],
        alertOnlyWithAgent: true,
      }
    );
  }

  async updateConfig(dto: UpdateCalendarConfigDto) {
    return this.prisma.auctionCalendarConfig.upsert({
      where: { id: CONFIG_ID },
      update: { ...dto },
      create: { id: CONFIG_ID, ...dto },
    });
  }

  // ── Avisos antes de que empiece una subasta ─────────────────────────────────

  /**
   * Configuracion de avisos + cuantas subastas entrarian ahora mismo con ese
   * umbral. Ese numero es lo que evita configurarlo a ciegas: el calendario
   * tiene cientos de entradas y el efecto de subir el umbral no es evidente.
   */
  async getAlerts() {
    const cfg = await this.getConfig();
    const alcance = await this.prisma.auctionCalendarEntry.count({
      where: {
        startedAt: {
          gte: new Date(),
          lte: new Date(Date.now() + (cfg.alertMinutesBefore ?? 30) * 60_000),
        },
        ...(cfg.alertOnlyWithAgent !== false ? { scraperAgentId: { not: null } } : {}),
      },
    });

    // Cuantas habria hoy en total con este filtro, para dar una idea del volumen
    // diario en vez de solo la ventana inmediata.
    const finDeDia = new Date();
    finDeDia.setHours(23, 59, 59, 999);
    const hoy = await this.prisma.auctionCalendarEntry.count({
      where: {
        startedAt: { gte: new Date(), lte: finDeDia },
        ...(cfg.alertOnlyWithAgent !== false ? { scraperAgentId: { not: null } } : {}),
      },
    });

    return {
      alertsEnabled: cfg.alertsEnabled ?? false,
      alertMinutesBefore: cfg.alertMinutesBefore ?? 30,
      alertChannelIds: cfg.alertChannelIds ?? [],
      alertOnlyWithAgent: cfg.alertOnlyWithAgent ?? true,
      /** Entran en la ventana ahora mismo. */
      inWindow: alcance,
      /** Quedan hoy con este filtro. */
      remainingToday: hoy,
    };
  }

  async updateAlerts(dto: UpdateCalendarAlertsDto) {
    await this.prisma.auctionCalendarConfig.upsert({
      where: { id: CONFIG_ID },
      update: { ...dto },
      create: { id: CONFIG_ID, ...dto },
    });
    return this.getAlerts();
  }

  /**
   * Filtro por estado EFECTIVO (ver effectiveCalendarStatus): manual primero,
   * luego fin por ENDAUC / status del calendario, luego la hora.
   */
  private whenWhere(when: string | undefined, now = Date.now()): Prisma.AuctionCalendarEntryWhereInput {
    const ahora = new Date(now);
    const desdeVivo = new Date(now - CALENDAR_LIVE_HOURS * 3_600_000);
    const auto = { manualStatus: null, endedAt: null, status: { not: 'ended' } };
    switch (when) {
      case 'live':
        return { OR: [{ manualStatus: 'live' }, { ...auto, startedAt: { lte: ahora, gt: desdeVivo } }] };
      case 'upcoming':
        return { OR: [{ manualStatus: 'upcoming' }, { ...auto, startedAt: { gt: ahora } }] };
      case 'past':
      case 'ended':
        return {
          OR: [
            { manualStatus: 'ended' },
            { manualStatus: null, OR: [{ endedAt: { not: null } }, { status: 'ended' }, { startedAt: { lte: desdeVivo } }] },
          ],
        };
      case 'today':
        return { saleDate: this.centralDate(ahora) };
      default:
        return {};
    }
  }

  async getStatus() {
    const [live, upcoming, ended, today, total, config] = await Promise.all([
      this.prisma.auctionCalendarEntry.count({ where: this.whenWhere('live') }),
      this.prisma.auctionCalendarEntry.count({ where: this.whenWhere('upcoming') }),
      this.prisma.auctionCalendarEntry.count({ where: this.whenWhere('past') }),
      this.prisma.auctionCalendarEntry.count({ where: this.whenWhere('today') }),
      this.prisma.auctionCalendarEntry.count(),
      this.getConfig(),
    ]);
    return { counts: { live, upcoming, ended, today, total }, total, config };
  }

  /**
   * `when`: live | today | upcoming | past | all (como el IAAI Calendar). Se
   * acepta todavia `status` (live/later/upcoming/ended del calendario) por
   * compatibilidad.
   */
  async list(params: { when?: string; status?: string; group?: string; q?: string; page?: number; limit?: number }) {
    const p = Math.max(1, Math.floor(Number(params.page) || 1));
    const l = Math.min(200, Math.max(1, Math.floor(Number(params.limit) || 50)));
    const and: Prisma.AuctionCalendarEntryWhereInput[] = [];
    if (params.when) and.push(this.whenWhere(params.when));
    else if (params.status) and.push({ status: params.status });
    if (params.group) and.push({ auctionGroup: params.group });
    const q = params.q?.trim();
    if (q) {
      and.push({
        OR: [
          { locationName: { contains: q, mode: 'insensitive' } },
          { locationSlug: { contains: q, mode: 'insensitive' } },
          { region: { equals: q.toUpperCase() } },
          ...(/^\d+$/.test(q) ? [{ locationSourceId: Number(q) }] : []),
        ],
      });
    }
    const where: Prisma.AuctionCalendarEntryWhereInput = and.length ? { AND: and } : {};
    const orderBy: Prisma.AuctionCalendarEntryOrderByWithRelationInput[] =
      params.when === 'past' ? [{ startedAt: 'desc' }, { locationName: 'asc' }] : [{ startedAt: 'asc' }, { locationName: 'asc' }];
    const now = Date.now();
    const [rows, total] = await Promise.all([
      this.prisma.auctionCalendarEntry.findMany({
        where,
        orderBy,
        skip: (p - 1) * l,
        take: l,
        select: {
          id: true,
          status: true,
          auctionGroup: true,
          locationSourceId: true,
          locationName: true,
          locationSlug: true,
          countryCode: true,
          region: true,
          startedAt: true,
          saleDate: true,
          totalAvailableItems: true,
          url: true,
          monitor: true,
          raw: true,
          endedLanes: true,
          endedAt: true,
          manualStatus: true,
          manualStatusAt: true,
          manualStatusBy: true,
          scraperAgentId: true,
          scraperAgent: {
            select: { id: true, firstName: true, lastName: true, email: true, auction: true },
          },
          scraperWorkerId: true,
          scraperWorker: { select: { id: true, label: true } },
        },
      }),
      this.prisma.auctionCalendarEntry.count({ where }),
    ]);
    const data = rows.map(({ raw, status, ...r }) => ({
      ...r,
      /** Estado efectivo (manual > ENDAUC/calendario > hora). */
      status: effectiveCalendarStatus({ ...r, status }, now),
      /** Lo que dijo AutoBidMaster en el ultimo refresco (live/later/upcoming/ended). */
      sourceStatus: status,
      laneCodes: copartLaneCodes(r.locationSourceId, raw),
    }));
    return { data, total, page: p, limit: l, pages: Math.max(1, Math.ceil(total / l)) };
  }

  /**
   * Estado a mano para una o varias subastas. `auto` lo quita. live/upcoming
   * reabren la subasta (borran las lanes con ENDAUC) para que la extension
   * vuelva a recibirla; la columna `status` se escribe tambien porque es la que
   * leen agentes, VMs y avisos.
   */
  async setStatus(ids: string[], status: CalendarStatus | 'auto', by: string | null) {
    const filas = await this.prisma.auctionCalendarEntry.findMany({
      where: { id: { in: ids } },
      select: { id: true, startedAt: true, endedAt: true },
    });
    const ahora = new Date();
    await this.prisma.$transaction(
      filas.map((f) =>
        this.prisma.auctionCalendarEntry.update({
          where: { id: f.id },
          data:
            status === 'auto'
              ? {
                  manualStatus: null,
                  manualStatusAt: null,
                  manualStatusBy: null,
                  status: f.endedAt ? 'ended' : timeStatus(f.startedAt),
                }
              : {
                  manualStatus: status,
                  manualStatusAt: ahora,
                  manualStatusBy: by,
                  status,
                  ...(status !== 'ended' ? { endedLanes: [], endedAt: null } : {}),
                },
        }),
      ),
    );
    return { updated: filas.length };
  }

  /** Toggle the staff "monitor" flag on one entry. */
  async setMonitor(id: string, monitor: boolean) {
    return this.prisma.auctionCalendarEntry.update({
      where: { id },
      data: { monitor },
      select: { id: true, monitor: true },
    });
  }
}
