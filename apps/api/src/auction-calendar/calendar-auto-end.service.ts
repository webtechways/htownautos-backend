import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@htownautos/prisma';
import { autoEndIdleAuctions, promoteCalendarByTime } from '@htownautos/common';

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

  // Cada minuto: el paso a live tiene que llegar antes que las VMs.
  @Cron('* * * * *')
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      // Primero por hora (live 15 min antes; ended pasadas 8 h), luego por inactividad.
      const p = await promoteCalendarByTime(this.prisma);
      if (p.live || p.ended) this.logger.log(`[Calendar] por hora: ${p.live} a live, ${p.ended} a ended`);
      // El fin por inactividad recorre 14 h de pujas: sigue cada 5 min.
      if (new Date().getMinutes() % 5 !== 0) return;
      const r = await autoEndIdleAuctions(this.prisma);
      if (r.lanes || r.auctions) this.logger.log(`[AutoEnd] ${r.lanes} lanes y ${r.auctions} subastas terminadas por inactividad`);
    } catch (err: any) {
      this.logger.warn(`[AutoEnd] fallo: ${err?.message ?? err}`);
    } finally {
      this.running = false;
    }
  }
}
