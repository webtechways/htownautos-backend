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
   * Que subastas del calendario se dan ahora, con prioridad al estado manual:
   *   manual live  → si (una persona la abrio, aunque este fuera de hora);
   *   manual ended / upcoming → no;
   *   automatico   → dentro de la ventana de hora, sin `endedAt` (todas sus
   *                  lanes mandaron ENDAUC) ni status ended.
   * Ademas cada lane con ENDAUC se quita una a una (`endedLanes`).
   */
  private ventana(lead: number, ahora: number) {
    return {
      OR: [
        { manualStatus: 'live', startedAt: { gte: new Date(ahora - 24 * 3_600_000) } },
        {
          manualStatus: null,
          endedAt: null,
          startedAt: {
            lte: new Date(ahora + lead * 60_000),
            gte: new Date(ahora - MAX_HORAS_DESDE_COMIENZO * 3_600_000),
          },
        },
      ],
    };
  }

  /**
   * IAAI: el calendario sale de iaai.com/branchlocations y las lanes son
   * candidatas (`iaa-643-a…`), porque la fuente no las trae.
   */
  private async iaai(lead: number, ahora: number): Promise<string[]> {
    const entradas = await this.prisma.iaaiCalendarEntry.findMany({
      where: this.ventana(lead, ahora),
      select: { laneCodes: true, endedLanes: true },
    });
    return entradas.flatMap((e) => e.laneCodes.filter((c) => !e.endedLanes.includes(c)));
  }

  private async copart(lead: number, ahora: number): Promise<string[]> {
    const entradas = await this.prisma.auctionCalendarEntry.findMany({
      where: { AND: [this.ventana(lead, ahora), { OR: [{ manualStatus: 'live' }, { status: { not: 'ended' } }] }] },
      select: { locationSourceId: true, raw: true, endedLanes: true },
    });
    return entradas.flatMap((e) => copartBroadcastRooms(e.locationSourceId, e.raw).filter((c) => !e.endedLanes.includes(c)));
  }
}

/** Lanes que se suscriben si el calendario aun no las trae: A–E (la E es la mayor vista). */
export const COPART_CANDIDATE_LANES = ['a', 'b', 'c', 'd', 'e'];

/**
 * Salas a las que suscribirse para una sede de Copart.
 *
 * El calendario solo rellena `lanes` cuando la subasta ya esta en vivo, y se
 * refresca cada pocas horas: una venta de las 20:00 sigue con `lanes: []`
 * cuando empieza. Entonces se suscriben las candidatas A–E; suscribirse a una
 * sala que no existe no cuesta nada (no llega ningun evento).
 *
 * No es `copartLaneCodes`: esa decide cuando una subasta termino (todas sus
 * lanes con ENDAUC), y ahi las candidatas no deben contar.
 */
export function copartBroadcastRooms(locationSourceId: number, raw: unknown): string[] {
  const r = (raw ?? {}) as Record<string, Array<{ lane?: string }> | undefined>;
  const conocidas = ['lanes', 'liveLanes', 'laterLanes']
    .flatMap((k) => (Array.isArray(r[k]) ? r[k]! : []))
    .map((l) => String(l?.lane ?? '').trim().toLowerCase())
    .filter((l) => /^[a-z]$/.test(l));
  const lanes = conocidas.length ? [...new Set(conocidas)] : COPART_CANDIDATE_LANES;
  return lanes.map((l) => `copart-${locationSourceId}-${l}`);
}
