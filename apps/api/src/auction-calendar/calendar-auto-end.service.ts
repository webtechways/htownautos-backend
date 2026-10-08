import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@htownautos/prisma';
import { autoEndIdleAuctions } from '@htownautos/common';

/**
 * Cierra solas las subastas (Copart e IAAI) cuando sus salas dejan de tener
 * actividad: el socket no avisa del fin. Cada 5 min; ver autoEndIdleAuctions.
 * Lo terminado deja de salir en /broadcast/live-rooms y en el reparto a las VMs.
 */
@Injectable()
export class CalendarAutoEndService {
  private readonly logger = new Logger(CalendarAutoEndService.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  @Cron('*/5 * * * *')
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const r = await autoEndIdleAuctions(this.prisma);
      if (r.lanes || r.auctions) this.logger.log(`[AutoEnd] ${r.lanes} lanes y ${r.auctions} subastas terminadas por inactividad`);
    } catch (err: any) {
      this.logger.warn(`[AutoEnd] fallo: ${err?.message ?? err}`);
    } finally {
      this.running = false;
    }
  }
}
