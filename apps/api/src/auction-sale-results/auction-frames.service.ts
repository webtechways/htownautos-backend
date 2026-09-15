import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import {
  RabbitMQService,
  AUCTION_FRAMES_QUEUE,
  type AuctionFrameMessage,
} from '@htownautos/rabbitmq';
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

    // `emittedAt` es timestamp sin zona, guardado en UTC: se compara con la
    // hora UTC de la base, no con `now()` a secas.
    const filas = await this.prisma.$queryRaw<
      Array<{ m5: bigint; m15: bigint; m60: bigint }>
    >`
      SELECT
        count(DISTINCT "saleRoom") FILTER (
          WHERE "emittedAt" > (now() AT TIME ZONE 'utc') - interval '5 minutes') AS m5,
        count(DISTINCT "saleRoom") FILTER (
          WHERE "emittedAt" > (now() AT TIME ZONE 'utc') - interval '15 minutes') AS m15,
        count(DISTINCT "saleRoom") AS m60
      FROM auction_bid_events
      WHERE "emittedAt" > (now() AT TIME ZONE 'utc') - interval '60 minutes'
    `;

    const f = filas[0];
    const datos: SalasActivas = {
      m5: Number(f?.m5 ?? 0),
      m15: Number(f?.m15 ?? 0),
      m60: Number(f?.m60 ?? 0),
    };
    this.salas = { calculadas: ahora, datos };
    return datos;
  }

  async ingest(dto: IngestFramesDto): Promise<FrameIngestSummary> {
    const frames = (dto.frames ?? []).filter((f) => typeof f === 'string' && f.length);
    if (!frames.length) return { received: 0, queued: 0 };

    const rows = await this.prisma.$transaction(
      frames.map((frame) =>
        this.prisma.auctionRawFrame.create({
          data: { frame, worker: dto.worker ?? null },
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

  /** Contadores en vivo para la pantalla de la cola. */
  async status() {
    const desde = new Date(Date.now() - 60_000);
    const [porEstado, ultimoMinuto, pendientes, ultimos] = await Promise.all([
      this.prisma.auctionRawFrame.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.auctionRawFrame.count({ where: { receivedAt: { gte: desde } } }),
      this.prisma.auctionRawFrame.count({ where: { status: 'pending' } }),
      this.prisma.auctionRawFrame.findMany({
        orderBy: { receivedAt: 'desc' },
        take: 25,
        select: {
          id: true, status: true, event: true, lot: true, worker: true,
          error: true, receivedAt: true, processedAt: true, summary: true,
        },
      }),
    ]);

    const counts: Record<string, number> = { pending: 0, processed: 0, failed: 0, ignored: 0 };
    for (const g of porEstado) counts[g.status] = g._count._all;

    const [bids, sales, salas] = await Promise.all([
      this.prisma.auctionBidEvent.count(),
      this.prisma.auctionSaleResult.count(),
      this.salasActivas(),
    ]);

    return {
      counts,
      queueDepth: pendientes,
      lastMinute: ultimoMinuto,
      rooms: salas,
      stored: { bids, sales },
      recent: ultimos.map((r) => ({ ...r, lot: r.lot?.toString() ?? null })),
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
}
