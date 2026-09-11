import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { ProxyService } from '@htownautos/common';
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
      this.fetchAndStore().catch((e) => this.logger.warn(`[Calendar] Initial fetch failed: ${e.message}`));
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
      await this.fetchAndStore();
    } catch (err: any) {
      this.logger.error(`[Calendar] Auto-refresh failed: ${err.message}`);
    }
  }

  /** Fetch the AutoBidMaster calendar, flatten it, and fully replace the table. */
  async fetchAndStore(): Promise<{ count: number }> {
    if (this.fetching) return { count: 0 };
    this.fetching = true;
    try {
      this.logger.log('[Calendar] Fetching AutoBidMaster auction calendar…');
      const res = await this.proxy.fetchViaProxy(CALENDAR_URL, {
        headers: BROWSER_HEADERS,
        maxAttempts: 4,
      });
      if (!res.ok) throw new Error(`AutoBidMaster returned ${res.status}`);
      const json = (await res.json()) as any;
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
          ],
        },
        select: {
          locationSourceId: true,
          startedAt: true,
          monitor: true,
          scraperAgentId: true,
          scraperWorkerId: true,
          alertedAt: true,
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
            rows.push({
              status,
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
      return { count: rows.length };
    } catch (err: any) {
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

  async getStatus() {
    const [grouped, config] = await Promise.all([
      this.prisma.auctionCalendarEntry.groupBy({ by: ['status'], _count: { _all: true } }),
      this.getConfig(),
    ]);
    const counts: Record<string, number> = { live: 0, later: 0, upcoming: 0, ended: 0 };
    for (const g of grouped) counts[g.status] = g._count._all;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return { counts, total, config };
  }

  async list(params: { status?: string; group?: string; page?: number; limit?: number }) {
    const p = Math.max(1, Math.floor(Number(params.page) || 1));
    const l = Math.min(200, Math.max(1, Math.floor(Number(params.limit) || 50)));
    const where: Prisma.AuctionCalendarEntryWhereInput = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.group ? { auctionGroup: params.group } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auctionCalendarEntry.findMany({
        where,
        orderBy: [{ startedAt: 'asc' }, { locationName: 'asc' }],
        skip: (p - 1) * l,
        take: l,
        select: {
          id: true,
          status: true,
          auctionGroup: true,
          locationName: true,
          locationSlug: true,
          countryCode: true,
          startedAt: true,
          saleDate: true,
          totalAvailableItems: true,
          url: true,
          monitor: true,
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
    return { data: rows, total, page: p, limit: l };
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
