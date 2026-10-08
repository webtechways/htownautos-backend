import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import {
  ProxyService,
  effectiveCalendarStatus,
  iaaiLaneCodes,
  parseIaaiBranchCalendar,
  type CalendarStatus,
} from '@htownautos/common';
import { UpdateIaaiCalendarConfigDto } from './dto/update-iaai-calendar-config.dto';

const CONFIG_ID = 'singleton';
const SOURCE_URL = 'https://www.iaai.com/branchlocations';

/** Cabeceras de navegador: la pagina es HTML publico detras de Imperva. */
const BROWSER_HEADERS: Record<string, string> = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'sec-ch-ua': '"Google Chrome";v="141", "Chromium";v="141", "Not)A;Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'upgrade-insecure-requests': '1',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
};

/** Cuanto despues del comienzo se sigue considerando "en vivo" una subasta. */
const LIVE_HOURS = 8;

export type IaaiCalendarStatus = 'upcoming' | 'live' | 'ended';

/** Filtro por estado EFECTIVO: manual > fin por ENDAUC > hora. */
function whenWhere(when: string | undefined, now = Date.now()): Prisma.IaaiCalendarEntryWhereInput {
  const ahora = new Date(now);
  const desdeVivo = new Date(now - LIVE_HOURS * 3_600_000);
  const auto = { manualStatus: null, endedAt: null };
  switch (when) {
    case 'live':
      return { OR: [{ manualStatus: 'live' }, { ...auto, startedAt: { lte: ahora, gt: desdeVivo } }] };
    case 'upcoming':
      return { OR: [{ manualStatus: 'upcoming' }, { ...auto, startedAt: { gt: ahora } }] };
    case 'past':
      return {
        OR: [
          { manualStatus: 'ended' },
          { manualStatus: null, OR: [{ endedAt: { not: null } }, { startedAt: { lte: desdeVivo } }] },
        ],
      };
    case 'today': {
      const hoy = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(ahora).replace(/-/g, ''));
      return { saleDate: hoy };
    }
    default:
      return {};
  }
}

/**
 * Calendario de subastas de IAAI: scrapea https://www.iaai.com/branchlocations
 * por el pool de Webshare, guarda la proxima subasta de cada sede y sus salas
 * candidatas del socket de difusion (`iaa-643-a…`).
 *
 * Upsert por `auctionId`, no reemplazo: las subastas pasadas se quedan como
 * historial, y la pagina solo muestra la PROXIMA de cada sede.
 */
/** Un intento de sync, tal como queda en el log. */
interface SyncAttempt {
  n: number;
  /** `direct`, `proxy` o `extension:<vm>`. */
  proxy: string;
  status: number | null;
  ms: number;
  error: string | null;
  at: string;
}

@Injectable()
export class IaaiCalendarService implements OnModuleInit {
  private readonly logger = new Logger(IaaiCalendarService.name);
  private fetching = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly proxy: ProxyService,
  ) {}

  async onModuleInit() {
    const cfg = await this.config();
    if (!cfg.lastFetchedAt) {
      this.fetchAndStore('boot').catch((e) => this.logger.warn(`[IaaiCalendar] Primera carga fallo: ${e.message}`));
    }
  }

  /** Cada hora se mira si toca segun `refreshHours`. */
  @Cron(CronExpression.EVERY_HOUR)
  async autoRefresh() {
    try {
      const cfg = await this.config();
      if (cfg.refreshHours <= 0) return;
      if (cfg.lastFetchedAt && Date.now() - cfg.lastFetchedAt.getTime() < cfg.refreshHours * 3_600_000) return;
      await this.fetchAndStore('cron');
    } catch (err: any) {
      this.logger.error(`[IaaiCalendar] Auto-refresh fallo: ${err.message}`);
    }
  }

  async config() {
    return this.prisma.iaaiCalendarConfig.upsert({
      where: { id: CONFIG_ID },
      create: { id: CONFIG_ID },
      update: {},
    });
  }

  async updateConfig(dto: UpdateIaaiCalendarConfigDto) {
    await this.config();
    const cfg = await this.prisma.iaaiCalendarConfig.update({ where: { id: CONFIG_ID }, data: dto });
    // Cambiar el numero de lanes rehace los candidatos de lo que aun no paso,
    // sin esperar al siguiente refresco.
    if (dto.lanesPerBranch !== undefined) await this.rebuildLaneCodes(cfg.lanesPerBranch);
    return cfg;
  }

  private async rebuildLaneCodes(lanes: number) {
    const vivas = await this.prisma.iaaiCalendarEntry.findMany({
      where: { startedAt: { gte: new Date(Date.now() - LIVE_HOURS * 3_600_000) } },
      select: { id: true, branchNumber: true },
    });
    await this.prisma.$transaction(
      vivas.map((e) =>
        this.prisma.iaaiCalendarEntry.update({
          where: { id: e.id },
          data: { laneCodes: iaaiLaneCodes(e.branchNumber, lanes) },
        }),
      ),
    );
  }

  /** Descarga desde el servidor, parsea y guarda. Devuelve cuantas subastas trajo. */
  async fetchAndStore(trigger: 'cron' | 'manual' | 'boot' = 'manual') {
    return this.runSync(trigger, null, async (attempts) => {
      const cfg = await this.config();
      const t = Date.now();
      const res = cfg.useProxy
        ? await this.proxy.fetchViaProxy(SOURCE_URL, { headers: BROWSER_HEADERS, maxAttempts: 4, timeoutMs: 60_000 })
        : await fetch(SOURCE_URL, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(60_000) });
      attempts.push({ n: 1, proxy: cfg.useProxy ? 'proxy' : 'direct', status: res.status, ms: Date.now() - t, error: res.ok ? null : `HTTP ${res.status}`, at: new Date().toISOString() });
      if (!res.ok) throw new Error(`iaai.com respondio ${res.status}`);
      return res.text();
    });
  }

  /**
   * La pagina que manda la extension de calendarios (un Chrome de verdad en
   * una VM): basta con el `<script id="locationsListVM">`, que es lo que lee
   * el parser. Si la extension no pudo leerla, se registra como sync fallida.
   */
  async ingestFromExtension(input: { worker: string; html?: string | null; status?: number | null; error?: string | null; ms?: number | null }) {
    return this.runSync('extension', input.worker, async (attempts) => {
      attempts.push({
        n: 1,
        proxy: `extension:${input.worker}`,
        status: input.status ?? null,
        ms: input.ms ?? 0,
        error: input.error ?? (input.html ? null : 'sin HTML'),
        at: new Date().toISOString(),
      });
      if (input.error) throw new Error(input.error);
      if (!input.html) throw new Error('la extension no mando HTML');
      return input.html;
    });
  }

  /** Ultimas sincronizaciones, la mas reciente primero. */
  async syncLogs(limit = 50) {
    const data = await this.prisma.iaaiCalendarSyncLog.findMany({ orderBy: { startedAt: 'desc' }, take: Math.min(Math.max(limit, 1), 300) });
    return { running: this.fetching, data };
  }

  /** Una sync: obtener el HTML, parsear, guardar y dejarla en el log. */
  private async runSync(
    trigger: 'cron' | 'manual' | 'boot' | 'extension',
    worker: string | null,
    obtener: (attempts: SyncAttempt[]) => Promise<string>,
  ): Promise<{ count: number; durationMs: number; skipped?: boolean }> {
    if (this.fetching) return { count: 0, durationMs: 0, skipped: true };
    this.fetching = true;
    const t0 = Date.now();
    const cfg = await this.config();
    const attempts: SyncAttempt[] = [];
    const log = await this.prisma.iaaiCalendarSyncLog.create({ data: { trigger, worker }, select: { id: true } }).catch(() => null);
    const cerrarLog = async (data: { ok: boolean; count?: number; error?: string }) => {
      if (log) {
        await this.prisma.iaaiCalendarSyncLog
          .update({ where: { id: log.id }, data: { ...data, finishedAt: new Date(), durationMs: Date.now() - t0, attempts: attempts as unknown as Prisma.InputJsonValue } })
          .catch(() => undefined);
      }
      // Ultimas 300 (~12 dias a una por hora).
      const corte = await this.prisma.iaaiCalendarSyncLog.findMany({ orderBy: { startedAt: 'desc' }, skip: 300, take: 1, select: { startedAt: true } }).catch(() => []);
      if (corte[0]) await this.prisma.iaaiCalendarSyncLog.deleteMany({ where: { startedAt: { lte: corte[0].startedAt } } }).catch(() => undefined);
    };
    try {
      this.logger.log(`[IaaiCalendar] Sync (${trigger}${worker ? ` · ${worker}` : ''})…`);
      const filas = parseIaaiBranchCalendar(await obtener(attempts), cfg.lanesPerBranch);
      if (!filas.length) throw new Error('branchlocations no trajo ninguna subasta');

      const ahora = new Date();
      // Una transaccion por tandas: 190 upserts de golpe es una peticion larga.
      for (let i = 0; i < filas.length; i += 50) {
        await this.prisma.$transaction(
          filas.slice(i, i + 50).map((f) => {
            const datos = {
              branchNumber: f.branchNumber,
              branchName: f.branchName,
              city: f.city,
              state: f.state,
              zip: f.zip,
              latitude: f.latitude,
              longitude: f.longitude,
              startedAt: f.startedAt,
              saleDate: f.saleDate,
              numberOfVehicles: f.numberOfVehicles,
              auctionSchedule: f.auctionSchedule,
              publicAuction: f.publicAuction,
              isBranchVirtual: f.isBranchVirtual,
              laneCodes: f.laneCodes,
              raw: f.raw as Prisma.InputJsonValue,
              fetchedAt: ahora,
            };
            return this.prisma.iaaiCalendarEntry.upsert({
              where: { auctionId: f.auctionId },
              create: { auctionId: f.auctionId, ...datos },
              update: datos,
            });
          }),
        );
      }

      const durationMs = Date.now() - t0;
      await this.prisma.iaaiCalendarConfig.update({
        where: { id: CONFIG_ID },
        data: { lastFetchedAt: ahora, lastCount: filas.length, lastError: null, lastDurationMs: durationMs },
      });
      this.logger.log(`[IaaiCalendar] ${filas.length} subastas guardadas en ${durationMs} ms`);
      await cerrarLog({ ok: true, count: filas.length });
      return { count: filas.length, durationMs };
    } catch (err: any) {
      await cerrarLog({ ok: false, error: String(err?.message ?? err).slice(0, 2000) });
      await this.prisma.iaaiCalendarConfig
        .update({
          where: { id: CONFIG_ID },
          data: { lastError: String(err?.message ?? err).slice(0, 500), lastDurationMs: Date.now() - t0 },
        })
        .catch(() => undefined);
      throw err;
    } finally {
      this.fetching = false;
    }
  }

  async status() {
    const cfg = await this.config();
    const ahora = new Date();
    const n = ahora.getTime();
    const [total, proximas, enVivo, terminadas, hoy] = await Promise.all([
      this.prisma.iaaiCalendarEntry.count(),
      this.prisma.iaaiCalendarEntry.count({ where: whenWhere('upcoming', n) }),
      this.prisma.iaaiCalendarEntry.count({ where: whenWhere('live', n) }),
      this.prisma.iaaiCalendarEntry.count({ where: whenWhere('past', n) }),
      this.prisma.iaaiCalendarEntry.count({ where: whenWhere('today', n) }),
    ]);
    return {
      config: cfg,
      fetching: this.fetching,
      counts: { total, upcoming: proximas, live: enVivo, ended: terminadas, today: hoy },
    };
  }

  /**
   * Listado para la pantalla. `when`: live (en curso), upcoming, past, today
   * (dia de Houston) o all.
   */
  async list(opts: { when?: string; q?: string; page?: number; pageSize?: number }) {
    const ahora = Date.now();
    const and: Prisma.IaaiCalendarEntryWhereInput[] = [whenWhere(opts.when, ahora)];
    if (opts.q?.trim()) {
      const q = opts.q.trim();
      and.push({ OR: [
        { branchName: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } },
        { state: { equals: q.toUpperCase() } },
        ...(/^\d+$/.test(q) ? [{ branchNumber: Number(q) }] : []),
      ] });
    }
    const where: Prisma.IaaiCalendarEntryWhereInput = { AND: and };
    const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 200);
    const page = Math.max(opts.page ?? 1, 1);
    // Lo pasado, de mas reciente a mas viejo; lo demas, por orden de comienzo.
    const orderBy: Prisma.IaaiCalendarEntryOrderByWithRelationInput[] =
      opts.when === 'past' ? [{ startedAt: 'desc' }] : [{ startedAt: 'asc' }, { branchName: 'asc' }];
    const [rows, total] = await Promise.all([
      this.prisma.iaaiCalendarEntry.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, auctionId: true, branchNumber: true, branchName: true, city: true, state: true,
          startedAt: true, saleDate: true, numberOfVehicles: true, auctionSchedule: true,
          publicAuction: true, isBranchVirtual: true, laneCodes: true, fetchedAt: true,
          endedLanes: true, endedAt: true, manualStatus: true, manualStatusAt: true, manualStatusBy: true,
        },
      }),
      this.prisma.iaaiCalendarEntry.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({ ...r, status: effectiveCalendarStatus(r, ahora) })),
      meta: { total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  /** Estado a mano; `auto` lo quita. live/upcoming reabren (borran los ENDAUC). */
  async setStatus(ids: string[], status: CalendarStatus | 'auto', by: string | null) {
    const data: Prisma.IaaiCalendarEntryUpdateManyMutationInput =
      status === 'auto'
        ? { manualStatus: null, manualStatusAt: null, manualStatusBy: null }
        : {
            manualStatus: status,
            manualStatusAt: new Date(),
            manualStatusBy: by,
            ...(status !== 'ended' ? { endedLanes: [], endedAt: null } : {}),
          };
    const r = await this.prisma.iaaiCalendarEntry.updateMany({ where: { id: { in: ids } }, data });
    return { updated: r.count };
  }
}
