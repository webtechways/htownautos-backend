import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import { IngestLogsDto } from './dto/ingest-logs.dto';

/** Cuanto se guarda. Lo que interesa es el ultimo par de semanas. */
const RETENCION_MS = 14 * 24 * 3_600_000;
/** La purga va a ratos, no en cada envio (llega uno por VM y minuto). */
const PURGA_CADA_MS = 3_600_000;

/**
 * Log remoto de la extension de las VM.
 *
 * Existe porque la extension corre en maquinas sin nadie delante: cuando "no
 * entro a las subastas" hay que poder ver si el planificador sonaba, que
 * decidio, si el worker murio a mitad de pasada o si la maquina se durmio.
 */
@Injectable()
export class ExtensionLogsService {
  private readonly logger = new Logger(ExtensionLogsService.name);
  private ultimaPurga = 0;

  constructor(private readonly prisma: PrismaService) {}

  async ingest(dto: IngestLogsDto): Promise<{ stored: number }> {
    const ahora = Date.now();
    const filas = dto.entries.map((e) => ({
      worker: dto.worker,
      version: dto.version ?? null,
      level: e.level,
      event: e.event,
      message: e.message,
      data: (e.data ?? undefined) as any,
      // Una fecha absurda (reloj de la VM roto) no debe romper el orden: se
      // guarda la de recepcion y el desfase queda en receivedAt vs at.
      at: new Date(Number.isFinite(e.at) && Math.abs(ahora - e.at) < 7 * 24 * 3_600_000 ? e.at : ahora),
    }));
    if (filas.length) await this.prisma.auctionExtensionLog.createMany({ data: filas });

    if (ahora - this.ultimaPurga > PURGA_CADA_MS) {
      this.ultimaPurga = ahora;
      this.prisma.auctionExtensionLog
        .deleteMany({ where: { at: { lt: new Date(ahora - RETENCION_MS) } } })
        .then((r) => r.count && this.logger.log(`[ExtLogs] ${r.count} entradas viejas purgadas`))
        .catch((err) => this.logger.warn(`[ExtLogs] purga fallo: ${err.message}`));
    }
    return { stored: filas.length };
  }

  /** Para la pantalla: lo ultimo, filtrable por VM, nivel y tipo. */
  async list(opts: { worker?: string; level?: string; event?: string; since?: Date; limit?: number }) {
    const take = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
    const [rows, workers] = await Promise.all([
      this.prisma.auctionExtensionLog.findMany({
        where: {
          ...(opts.worker ? { worker: opts.worker } : {}),
          ...(opts.level ? { level: opts.level } : {}),
          ...(opts.event ? { event: opts.event } : {}),
          ...(opts.since ? { at: { gte: opts.since } } : {}),
        },
        orderBy: { at: 'desc' },
        take,
      }),
      // Cada VM con su ultima señal: la que lleve rato callada es la que fallo.
      this.prisma.auctionExtensionLog.groupBy({
        by: ['worker'],
        _max: { at: true, receivedAt: true },
        where: { at: { gte: new Date(Date.now() - 2 * 24 * 3_600_000) } },
      }),
    ]);
    return {
      rows: rows.map((r) => ({ ...r, id: r.id.toString() })),
      workers: workers.map((w) => ({ worker: w.worker, lastAt: w._max.at, lastReceivedAt: w._max.receivedAt })),
    };
  }
}
