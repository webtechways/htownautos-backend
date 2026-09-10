import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@htownautos/prisma';

/**
 * Purga de `auction_raw_frames`.
 *
 * La tabla recibe ~1,4 millones de filas al dia. Sin purga crece 1 TB al año, y
 * ademas cada `pg_dump` diario se lleva ese peso multiplicado por los dias de
 * copias que se conserven.
 *
 * Los plazos salen de para que sirve cada estado:
 *
 * - **processed**: el dato ya vive en `auction_bid_events` o
 *   `auction_sale_results`. La fila solo sirve para el Live Feed, que enseña los
 *   ultimos 25. Dos dias es de sobra.
 * - **ignored**: eventos que todavia no tratamos. Su valor es darnos cuenta de
 *   que existen y ver sus campos para decidir — y eso pasa en dias, no en meses.
 *   Siete dias cubre un fin de semana largo sin mirar el panel.
 * - **failed**: los unicos que de verdad se reprocesan, y los unicos que
 *   conservan el frame crudo. Noventa dias, porque son rarisimos (hoy: cero) y
 *   perder uno es perder el caso que rompio el parser.
 */
const DIAS = { processed: 2, ignored: 7, failed: 90 } as const;

/** Por tandas: un DELETE de cientos de miles de filas bloquea la tabla. */
const BATCH = 10_000;

@Injectable()
export class AuctionFramesRetentionService {
  private readonly logger = new Logger(AuctionFramesRetentionService.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async purge(): Promise<Record<string, number>> {
    // Cada hora y por tandas: si una pasada se solapa con la siguiente, la
    // segunda no arranca en vez de pelearse por los mismos bloqueos.
    if (this.running) return {};
    this.running = true;
    const borrado: Record<string, number> = {};

    try {
      for (const [status, dias] of Object.entries(DIAS)) {
        const corte = new Date(Date.now() - dias * 86_400_000);
        let total = 0;

        // Se repite hasta vaciar el atraso, con tope de pasadas para que una
        // acumulacion enorme no monopolice la conexion una hora entera.
        for (let vuelta = 0; vuelta < 20; vuelta++) {
          const lote = await this.prisma.auctionRawFrame.findMany({
            where: { status, receivedAt: { lt: corte } },
            select: { id: true },
            take: BATCH,
          });
          if (!lote.length) break;

          const res = await this.prisma.auctionRawFrame.deleteMany({
            where: { id: { in: lote.map((r) => r.id) } },
          });
          total += res.count;
          if (lote.length < BATCH) break;
        }

        if (total > 0) borrado[status] = total;
      }

      if (Object.keys(borrado).length) {
        const detalle = Object.entries(borrado)
          .map(([k, v]) => `${v.toLocaleString()} ${k}`)
          .join(', ');
        this.logger.log(`[Frames] Purgados ${detalle}`);
      }
      return borrado;
    } catch (err: any) {
      this.logger.error(`[Frames] Purga fallida: ${err.message}`);
      return borrado;
    } finally {
      this.running = false;
    }
  }
}
