import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import {
  RabbitMQService,
  AUCTION_FRAMES_QUEUE,
  type AuctionFrameMessage,
} from '@htownautos/rabbitmq';
import { broadcastAuctionOf } from '@htownautos/common';
import { IngestFramesDto } from './dto/ingest-frames.dto';

export interface FrameIngestSummary {
  received: number;
  queued: number;
}

/** Salas distintas que han mandado algo en cada ventana. */
export interface SalasActivas {
  m5: number;
  m15: number;
  m60: number;
}

/**
 * Recibe los frames crudos de la subasta en vivo y los encola.
 *
 * Aqui no se decodifica nada a proposito. Con 49 salas abiertas llegan rafagas,
 * y parsear + escribir dentro de la peticion HTTP convierte cualquier pico en
 * timeouts en las VM. Guardar el crudo y encolar el id es O(1).
 */
@Injectable()
export class AuctionFramesService {
  private readonly logger = new Logger(AuctionFramesService.name);

  /**
   * El recuento de salas, con su momento.
   *
   * La pantalla pregunta cada 2s y este numero se mueve en minutos, no en
   * segundos: repetir la consulta treinta veces por minuto seria tirar trabajo.
   */
  private salas: { calculadas: number; datos: SalasActivas } | null = null;
  private salasIaai: { calculadas: number; datos: SalasActivas } | null = null;
  private static readonly SALAS_TTL_MS = 10_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbit: RabbitMQService,
  ) {}

  /**
   * Cuantas salas distintas han enviado datos en los ultimos 5, 15 y 60 min.
   *
   * Las tres ventanas salen de **una sola pasada** por el indice de
   * `emittedAt`: pedir tres veces lo mismo con distinto intervalo cuesta el
   * triple y da lo mismo. Medido en produccion: 62 ms para las tres, con 36.000
   * filas en la ventana de una hora. El coste depende de la ventana, no del
   * tamano de la tabla, asi que no crece con los dias.
   *
   * Se usa `emittedAt` —el instante del evento— y no `receivedAt`, por dos
   * razones: es el que tiene indice, y es el que responde a la pregunta de
   * verdad ("que salas estan vivas"). El desfase entre ambos es de medio
   * segundo.
   */
  async salasActivas(): Promise<SalasActivas> {
    const ahora = Date.now();
    if (this.salas && ahora - this.salas.calculadas < AuctionFramesService.SALAS_TTL_MS) {
      return this.salas.datos;
    }
    // Copart: pujas con importe (Solace y difusion con sesion) y sin importe
    // (difusion sin sesion). La misma sala se llama COPART194B en unas y
    // copart-194-b en otras: se normaliza para no contarla dos veces.
    const filas = await this.prisma.$queryRaw<Array<{ room: string; at: Date }>>`
      SELECT "saleRoom" AS room, max("emittedAt") AS at FROM auction_bid_events
       WHERE "emittedAt" > (now() AT TIME ZONE 'utc') - interval '60 minutes' AND "saleRoom" IS NOT NULL
       GROUP BY "saleRoom"
      UNION ALL
      SELECT room, max("lastSeenAt") AS at FROM bid_no_price
       WHERE "firstSeenAt" > (now() AT TIME ZONE 'utc') - interval '75 minutes'
       GROUP BY room`;
    const datos = this.contarSalas(filas, (r) => r.toLowerCase().replace(/^copart0*(\d+)([a-z0-9])$/, 'copart-$1-$2'));
    this.salas = { calculadas: ahora, datos };
    return datos;
  }

  /** Lo mismo para IAAI: salas `iaa-…` con pujas (con o sin importe). */
  async salasActivasIaai(): Promise<SalasActivas> {
    const ahora = Date.now();
    if (this.salasIaai && ahora - this.salasIaai.calculadas < AuctionFramesService.SALAS_TTL_MS) {
      return this.salasIaai.datos;
    }
    const filas = await this.prisma.$queryRaw<Array<{ room: string; at: Date }>>`
      SELECT room, max("lastSeenAt") AS at FROM iaai_bid_events
       WHERE "firstSeenAt" > (now() AT TIME ZONE 'utc') - interval '75 minutes' GROUP BY room
      UNION ALL
      SELECT room, max("lastSeenAt") AS at FROM bid_no_price_iaai
       WHERE "firstSeenAt" > (now() AT TIME ZONE 'utc') - interval '75 minutes' GROUP BY room`;
    const datos = this.contarSalas(filas, (r) => r.toLowerCase());
    this.salasIaai = { calculadas: ahora, datos };
    return datos;
  }

  /** Salas distintas con algo en los ultimos 5/15/60 min (columnas UTC sin zona). */
  private contarSalas(filas: Array<{ room: string; at: Date }>, norma: (r: string) => string): SalasActivas {
    const ultima = new Map<string, number>();
    for (const f of filas) {
      if (!f.room || !f.at) continue;
      const k = norma(f.room);
      ultima.set(k, Math.max(ultima.get(k) ?? 0, new Date(f.at).getTime()));
    }
    const ahora = Date.now();
    const en = (min: number) => [...ultima.values()].filter((t) => ahora - t < min * 60_000).length;
    return { m5: en(5), m15: en(15), m60: en(60) };
  }

  async ingest(dto: IngestFramesDto): Promise<FrameIngestSummary> {
    const source = dto.source ?? 'room';
    // Se filtra con su instante al lado: filtrar primero descuadraria
    // `capturedAt`, que va por posicion.
    const frames = (dto.frames ?? [])
      .map((frame, i) => ({ frame, at: dto.capturedAt?.[i] }))
      .filter(({ frame }) => typeof frame === 'string' && frame.length);
    if (!frames.length) return { received: 0, queued: 0 };

    const ahora = Date.now();
    const rows = await this.prisma.$transaction(
      frames.map(({ frame, at }) =>
        this.prisma.auctionRawFrame.create({
          data: {
            frame,
            source,
            // Un reloj de VM desajustado no puede fechar eventos en el futuro
            // ni con dias de retraso: fuera de ±1 h se usa el del servidor.
            capturedAt: new Date(at && Math.abs(ahora - at) < 3_600_000 ? at : ahora),
            worker: dto.worker ?? null,
          },
          select: { id: true },
        }),
      ),
    );

    let queued = 0;
    for (const row of rows) {
      const msg: AuctionFrameMessage = { frameId: row.id };
      // Si RabbitMQ no acepta el mensaje, la fila se queda en `pending` y el
      // barrido la recoge. Perder el frame por un fallo de la cola seria peor:
      // estos eventos no se repiten.
      await this.rabbit
        .publish(AUCTION_FRAMES_QUEUE, msg)
        .then(() => queued++)
        .catch((e) => this.logger.warn(`[Frames] No se pudo encolar ${row.id}: ${e.message}`));
    }

    return { received: frames.length, queued };
  }

  /** Ultimo calculo del panel de difusion: la pantalla pregunta cada 2 s. */
  private bcast: { at: number; data: unknown } | null = null;

  /**
   * Panel "Broadcast" del Live Feed: que fuentes estan mandando, que VM, y como
   * se llenan bid_no_price (Copart) y bid_no_price_iaai (IAAI).
   *
   * Todas las ventanas filtran por columnas con indice (`receivedAt`,
   * `firstSeenAt`); los timestamps se guardan en UTC sin zona, asi que se
   * compara con la hora UTC de la base.
   */
  async broadcastStatus() {
    const ahora = Date.now();
    if (this.bcast && ahora - this.bcast.at < 5_000) return this.bcast.data;

    const [fuentes, workers, copart, iaai, recientes] = await Promise.all([
      this.prisma.$queryRaw<Array<{ source: string; m1: bigint; m5: bigint; last: Date | null }>>`
        SELECT source,
               count(*) FILTER (WHERE "receivedAt" > (now() AT TIME ZONE 'utc') - interval '1 minute') AS m1,
               count(*) AS m5, max("receivedAt") AS last
        FROM auction_raw_frames
        WHERE "receivedAt" > (now() AT TIME ZONE 'utc') - interval '5 minutes'
        GROUP BY source`,
      this.prisma.$queryRaw<Array<{ worker: string | null; source: string; frames: bigint; last: Date }>>`
        SELECT worker, source, count(*) AS frames, max("receivedAt") AS last
        FROM auction_raw_frames
        WHERE "receivedAt" > (now() AT TIME ZONE 'utc') - interval '10 minutes'
        GROUP BY worker, source ORDER BY max("receivedAt") DESC LIMIT 50`,
      this.noPriceStats('bid_no_price'),
      this.noPriceStats('bid_no_price_iaai'),
      this.prisma.$queryRaw<Array<Record<string, unknown>>>`
        (SELECT 'copart' AS auction, id, room, lot::text AS lot, "order", country, sold, round, "seenCount", "lastSeenAt"
           FROM bid_no_price ORDER BY "firstSeenAt" DESC LIMIT 25)
        UNION ALL
        (SELECT 'iaai' AS auction, id, room, lot::text AS lot, "order", country, sold, round, "seenCount", "lastSeenAt"
           FROM bid_no_price_iaai ORDER BY "firstSeenAt" DESC LIMIT 25)
        ORDER BY "lastSeenAt" DESC LIMIT 30`,
    ]);

    const data = {
      sources: fuentes.map((f) => ({ source: f.source, lastMinute: Number(f.m1), last5m: Number(f.m5), lastAt: f.last })),
      workers: workers.map((w) => ({ worker: w.worker, source: w.source, frames10m: Number(w.frames), lastAt: w.last })),
      noPrice: { copart, iaai },
      recentNoPrice: recientes,
    };
    this.bcast = { at: ahora, data };
    return data;
  }

  /** Pulso de una tabla de pujas sin importe. */
  private async noPriceStats(tabla: 'bid_no_price' | 'bid_no_price_iaai') {
    const t = Prisma.raw(tabla === 'bid_no_price_iaai' ? 'bid_no_price_iaai' : 'bid_no_price');
    type Fila = { m1: bigint; m5: bigint; rooms5: bigint; hoy: bigint; vendidos: bigint; fuentes: number | null; last: Date | null };
    const [r] = (await this.prisma.$queryRaw(Prisma.sql`
      SELECT count(*) FILTER (WHERE "firstSeenAt" > (now() AT TIME ZONE 'utc') - interval '1 minute') AS m1,
             count(*) FILTER (WHERE "firstSeenAt" > (now() AT TIME ZONE 'utc') - interval '5 minutes') AS m5,
             count(DISTINCT room) FILTER (WHERE "firstSeenAt" > (now() AT TIME ZONE 'utc') - interval '5 minutes') AS rooms5,
             count(*) AS hoy,
             count(*) FILTER (WHERE sold) AS vendidos,
             avg("seenCount") FILTER (WHERE "firstSeenAt" > (now() AT TIME ZONE 'utc') - interval '5 minutes')::float AS fuentes,
             max("lastSeenAt") AS last
      FROM ${t}
      WHERE "firstSeenAt" > (now() AT TIME ZONE 'utc') - interval '24 hours'`)) as Fila[];
    return {
      lastMinute: Number(r?.m1 ?? 0),
      last5m: Number(r?.m5 ?? 0),
      rooms5m: Number(r?.rooms5 ?? 0),
      last24h: Number(r?.hoy ?? 0),
      sold24h: Number(r?.vendidos ?? 0),
      /** Cuantas veces llega cada puja de media: ~ cuantas fuentes la estan viendo. */
      avgSeen5m: r?.fuentes ?? null,
      lastAt: r?.last ?? null,
    };
  }

  /**
   * Totales pesados (GROUP BY de toda la cola y COUNT de millones de pujas):
   * la pantalla los pide cada pocos segundos por pestaña, y contarlos en
   * exacto cada vez saturaba el disco. Se cachean 30 s y los grandes son
   * estimaciones del planner (pg_class.reltuples), suficientes para un panel.
   */
  private heavyCache: { at: number; value: Promise<{ porEstado: { status: string; n: number }[]; bids: number; sales: number }> } | null = null;

  private heavyTotals() {
    if (this.heavyCache && Date.now() - this.heavyCache.at < 30_000) return this.heavyCache.value;
    const value = (async () => {
      const [porEstado, est] = await Promise.all([
        this.prisma.$queryRaw<{ status: string; n: bigint }[]>`
          SELECT status, count(*) AS n FROM auction_raw_frames GROUP BY status`,
        this.prisma.$queryRaw<{ relname: string; n: number }[]>`
          SELECT relname, GREATEST(reltuples, 0)::float8 AS n FROM pg_class
          WHERE relname IN ('auction_bid_events', 'auction_sale_results') AND relkind = 'r'`,
      ]);
      const of = (t: string) => Math.round(Number(est.find((e) => e.relname === t)?.n ?? 0));
      return {
        porEstado: porEstado.map((r) => ({ status: r.status, n: Number(r.n) })),
        bids: of('auction_bid_events'),
        sales: of('auction_sale_results'),
      };
    })();
    value.catch(() => { this.heavyCache = null; });
    this.heavyCache = { at: Date.now(), value };
    return value;
  }

  /** Contadores en vivo para la pantalla de la cola. */
  async status() {
    const desde = new Date(Date.now() - 60_000);
    const [heavy, ultimoMinuto, pendientes, ultimos, salas, salasIaai] = await Promise.all([
      this.heavyTotals(),
      this.prisma.auctionRawFrame.count({ where: { receivedAt: { gte: desde } } }),
      this.prisma.auctionRawFrame.count({ where: { status: 'pending' } }),
      this.prisma.auctionRawFrame.findMany({
        orderBy: { receivedAt: 'desc' },
        take: 25,
        select: {
          id: true, status: true, event: true, lot: true, worker: true,
          error: true, receivedAt: true, processedAt: true, summary: true, source: true, frame: true,
        },
      }),
      this.salasActivas(),
      this.salasActivasIaai(),
    ]);

    const counts: Record<string, number> = { pending: 0, processed: 0, failed: 0, ignored: 0 };
    for (const g of heavy.porEstado) counts[g.status] = g.n;
    counts.pending = pendientes;
    const { bids, sales } = heavy;

    return {
      counts,
      queueDepth: pendientes,
      lastMinute: ultimoMinuto,
      /** Salas de Copart enviando (Solace + difusion). */
      rooms: salas,
      /** Salas de IAAI enviando (difusion de SalvageBid). */
      roomsIaai: salasIaai,
      stored: { bids, sales },
      recent: ultimos.map(({ frame, source, ...r }) => ({
        ...r,
        lot: r.lot?.toString() ?? null,
        source,
        auction: this.subastaDe(source, r.summary, frame),
      })),
    };
  }

  /**
   * Reencola lo que quedo colgado: `pending` viejos (la cola los perdio) y los
   * `failed` cuando se arregla el parser. Es lo que hace util guardar el crudo.
   */
  async requeue(status: 'pending' | 'failed', olderThanMinutes = 0): Promise<{ requeued: number }> {
    const where: any = { status };
    if (olderThanMinutes > 0) {
      where.receivedAt = { lt: new Date(Date.now() - olderThanMinutes * 60_000) };
    }
    const rows = await this.prisma.auctionRawFrame.findMany({
      where,
      select: { id: true },
      take: 5000,
    });
    if (!rows.length) return { requeued: 0 };

    await this.prisma.auctionRawFrame.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { status: 'pending', error: null },
    });

    let requeued = 0;
    for (const r of rows) {
      await this.rabbit
        .publish(AUCTION_FRAMES_QUEUE, { frameId: r.id } as AuctionFrameMessage)
        .then(() => requeued++)
        .catch(() => undefined);
    }
    this.logger.log(`[Frames] ${requeued} frame(s) reencolados desde ${status}`);
    return { requeued };
  }

  /**
   * De que subasta es un frame: la sala Solace es siempre Copart; en difusion
   * lo dice la sala (`copart-…` / `iaa-…`), del resumen si ya se decodifico o
   * del texto crudo si aun esta pendiente.
   */
  private subastaDe(source: string | null, summary: unknown, frame: string | null): 'copart' | 'iaai' | null {
    if (source !== 'broadcast') return 'copart';
    const deResumen = broadcastAuctionOf((summary as { fields?: { auction?: unknown } } | null)?.fields?.auction);
    if (deResumen) return deResumen;
    const m = /"auction"\s*:\s*"((?:copart|iaa)-[^"]*)"/i.exec(frame ?? '');
    return m ? broadcastAuctionOf(m[1]) : null;
  }

  /**
   * Lo nuevo para el ticker del Live Feed, desde un cursor (receivedAt, id).
   *
   * Barato a proposito, porque cada pestaña lo pide cada segundo: rango por el
   * indice de `receivedAt` (filas recien escritas, en memoria), sin conteos y
   * solo con lo que se pinta. Se piden las que llegaron hace mas de 3 s: para
   * entonces casi todas estan decodificadas y cada fila sale una vez y completa.
   * Sin cursor devuelve las ultimas 40, para arrancar.
   */
  async stream(opts: { after?: string; afterId?: string; events?: string[]; includeIgnored?: boolean; limit?: number }) {
    const limit = Math.min(Math.max(opts.limit ?? 300, 1), 500);
    const hasta = new Date(Date.now() - 3_000);
    const after = opts.after ? new Date(opts.after) : null;
    const where: Prisma.AuctionRawFrameWhereInput = {
      receivedAt: { lte: hasta, ...(after && !isNaN(after.getTime()) ? {} : { gte: new Date(Date.now() - 120_000) }) },
      status: opts.includeIgnored ? { not: 'pending' } : { in: ['processed', 'failed'] },
      ...(opts.events?.length ? { event: { in: opts.events } } : {}),
      ...(after && !isNaN(after.getTime())
        ? {
            OR: [
              { receivedAt: { gt: after } },
              ...(opts.afterId ? [{ receivedAt: after, id: { gt: opts.afterId } }] : []),
            ],
          }
        : {}),
    };
    const semilla = !(after && !isNaN(after.getTime()));
    const filas = await this.prisma.auctionRawFrame.findMany({
      where,
      orderBy: semilla ? [{ receivedAt: 'desc' }, { id: 'desc' }] : [{ receivedAt: 'asc' }, { id: 'asc' }],
      take: semilla ? 40 : limit,
      select: {
        id: true, status: true, event: true, lot: true, worker: true, error: true,
        receivedAt: true, source: true, summary: true,
      },
    });
    if (semilla) filas.reverse();
    const ultima = filas[filas.length - 1];
    return {
      rows: filas.map((r) => {
        const sm = (r.summary ?? {}) as Record<string, any>;
        return {
          id: r.id,
          at: r.receivedAt,
          auction: this.subastaDe(r.source, r.summary, null),
          event: r.event,
          lot: r.lot?.toString() ?? null,
          amount: sm.amount ?? null,
          ask: sm.askBid ?? null,
          buyer: sm.buyerNo ?? null,
          buyerWhere: [sm.buyerState, sm.buyerCountry].filter(Boolean).join(' ') || null,
          status: r.status,
          worker: r.worker,
          error: r.error ? String(r.error).slice(0, 120) : null,
        };
      }),
      /** Siguiente cursor; si no llego nada, el mismo de entrada. */
      cursor: ultima
        ? { after: ultima.receivedAt.toISOString(), afterId: ultima.id }
        : { after: after && !isNaN(after.getTime()) ? after.toISOString() : hasta.toISOString(), afterId: opts.afterId ?? null },
      /** Si se llego al tope hay mas esperando: el cliente puede pedir ya. */
      more: !semilla && filas.length === limit,
    };
  }

  /** Un frame completo (el detalle al pulsar una fila del ticker). */
  async frame(id: string) {
    const r = await this.prisma.auctionRawFrame.findUnique({
      where: { id },
      select: {
        id: true, status: true, event: true, lot: true, worker: true, error: true,
        receivedAt: true, processedAt: true, summary: true, source: true,
      },
    });
    if (!r) return null;
    return { ...r, lot: r.lot?.toString() ?? null, auction: this.subastaDe(r.source, r.summary, null) };
  }
}
