import { Injectable } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';

/** Cuanto antes del comienzo se considera "en vivo" una subasta, por defecto. */
export const BROADCAST_LEAD_MINUTES = 15;
/**
 * Hasta cuando se sigue dando una subasta despues de su comienzo. No hay hora
 * de fin en el calendario; la lane mas larga vista (209 lotes) dura unas 2-3 h,
 * asi que 8 h cubre de sobra. Suscribirse a una sala ya terminada no cuesta
 * nada: simplemente no llega ningun evento.
 */
const MAX_HORAS_DESDE_COMIENZO = 8;

export type BroadcastAuction = 'copart' | 'iaai' | 'all';

export interface LiveRooms {
  /** Codigos del socket de difusion: `copart-194-d`, `iaa-643-c`. */
  rooms: string[];
  auction: BroadcastAuction;
  leadMinutes: number;
  generatedAt: string;
}

/**
 * Las salas a las que tiene que suscribirse la extension en modo Broadcast.
 *
 * Salen del Auction Calendar: cada sede del dia trae sus lanes en `raw.lanes`.
 * El codigo es `copart-` + sede SIN ceros a la izquierda + `-` + lane en
 * minuscula — comprobado contra el socket (copart-25-a responde, copart-025-a no).
 *
 * El `startedAt` del calendario es fiable para las pujas en sala: la primera
 * BIDREC llega segundos despues. Lo de antes son PREBID, que no pasan por la
 * difusion.
 */
@Injectable()
export class BroadcastRoomsService {
  constructor(private readonly prisma: PrismaService) {}

  async live(leadMinutes = BROADCAST_LEAD_MINUTES, auction: BroadcastAuction = 'copart'): Promise<LiveRooms> {
    const lead = Math.min(Math.max(Math.round(leadMinutes), 0), 180);
    const ahora = Date.now();
    const rooms = new Set<string>();
    if (auction !== 'iaai') for (const r of await this.copart(lead, ahora)) rooms.add(r);
    if (auction !== 'copart') for (const r of await this.iaai(lead, ahora)) rooms.add(r);
    return { rooms: [...rooms].sort(), auction, leadMinutes: lead, generatedAt: new Date(ahora).toISOString() };
  }

  /**
   * IAAI: el calendario sale de iaai.com/branchlocations y las lanes son
   * candidatas (`iaa-643-a…`), porque la fuente no las trae.
   */
  private async iaai(lead: number, ahora: number): Promise<string[]> {
    const entradas = await this.prisma.iaaiCalendarEntry.findMany({
      where: {
        startedAt: {
          lte: new Date(ahora + lead * 60_000),
          gte: new Date(ahora - MAX_HORAS_DESDE_COMIENZO * 3_600_000),
        },
      },
      select: { laneCodes: true },
    });
    return entradas.flatMap((e) => e.laneCodes);
  }

  private async copart(lead: number, ahora: number): Promise<string[]> {
    const entradas = await this.prisma.auctionCalendarEntry.findMany({
      where: {
        startedAt: {
          lte: new Date(ahora + lead * 60_000),
          gte: new Date(ahora - MAX_HORAS_DESDE_COMIENZO * 3_600_000),
        },
        status: { not: 'ended' },
      },
      select: { locationSourceId: true, raw: true },
    });

    const rooms: string[] = [];
    for (const e of entradas) {
      const lanes = (e.raw as { lanes?: Array<{ lane?: string }> } | null)?.lanes ?? [];
      for (const l of lanes) {
        const lane = String(l?.lane ?? '').trim().toLowerCase();
        if (/^[a-z]$/.test(lane)) rooms.push(`copart-${e.locationSourceId}-${lane}`);
      }
    }
    return rooms;
  }
}
