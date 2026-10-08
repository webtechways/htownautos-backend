import { Injectable } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import { roomCodeOf } from '@htownautos/common';

/** Cuanto antes del comienzo se considera "en vivo" una subasta, por defecto. */
export const BROADCAST_LEAD_MINUTES = 15;
/**
 * Hasta cuando se sigue dando una subasta despues de su comienzo. No hay hora
 * de fin en el calendario; la lane mas larga vista (209 lotes) dura unas 2-3 h,
 * asi que 8 h cubre de sobra. Suscribirse a una sala ya terminada no cuesta
 * nada: simplemente no llega ningun evento.
 */
const MAX_HORAS_DESDE_COMIENZO = 8;

/**
 * Lanes candidatas (las que se suscriben "por si acaso": IAAI siempre, Copart
 * cuando el calendario aun no trae lanes): pasado esto desde el comienzo, una
 * que no tuvo NINGUN evento —con precio o sin el— se deja de dar. Una lane real
 * empieza a pujar a los pocos minutos.
 */
export const CANDIDATE_NO_SHOW_MINUTES = 30;
/**
 * Solo se descartan candidatas si la captura de esa subasta esta viva (algun
 * evento de Copart, o de IAAI, en estos minutos). Si no, el silencio puede ser
 * que nadie escuchaba, y quitarlas impediria volver a escucharlas.
 */
const CAPTURA_SANA_MINUTOS = 10;
/** La actividad por sala se reutiliza este tiempo: la piden todas las VMs cada 2 min. */
const ACTIVIDAD_CACHE_MS = 60_000;

type Actividad = { porSala: Map<string, number>; ultimaCopart: number; ultimaIaai: number };

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
  private actividadCache: { at: number; value: Actividad } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ultimo evento por sala (codigo de difusion) en las ultimas 10 h, de las
   * cuatro tablas: Copart e IAAI, con precio y sin el. Cualquier evento cuenta.
   */
  private async actividad(ahora: number): Promise<Actividad> {
    if (this.actividadCache && ahora - this.actividadCache.at < ACTIVIDAD_CACHE_MS) return this.actividadCache.value;
    const desde = new Date(ahora - 10 * 3_600_000);
    const filas: Array<{ room: string | null; last: Date | null }> = (await this.prisma.$queryRaw`
      SELECT room, max("lastSeenAt") AS last FROM bid_no_price WHERE "firstSeenAt" >= ${desde} GROUP BY room
      UNION ALL
      SELECT "saleRoom" AS room, max("emittedAt") AS last FROM auction_bid_events
       WHERE "emittedAt" >= ${desde} AND "saleRoom" IS NOT NULL GROUP BY "saleRoom"
      UNION ALL
      SELECT room, max("lastSeenAt") AS last FROM iaai_bid_events WHERE "firstSeenAt" >= ${desde} GROUP BY room
      UNION ALL
      SELECT room, max("lastSeenAt") AS last FROM bid_no_price_iaai WHERE "firstSeenAt" >= ${desde} GROUP BY room`) as any;
    const value: Actividad = { porSala: new Map(), ultimaCopart: 0, ultimaIaai: 0 };
    for (const f of filas) {
      const code = roomCodeOf(f.room);
      if (!code || !f.last) continue;
      const t = new Date(f.last).getTime();
      if (t > (value.porSala.get(code) ?? 0)) value.porSala.set(code, t);
      if (code.startsWith('copart-')) value.ultimaCopart = Math.max(value.ultimaCopart, t);
      else if (code.startsWith('iaa-')) value.ultimaIaai = Math.max(value.ultimaIaai, t);
    }
    this.actividadCache = { at: ahora, value };
    return value;
  }

  /**
   * Quita las candidatas que no se presentaron: pasados CANDIDATE_NO_SHOW_MINUTES
   * desde el comienzo, sin ningun evento desde (comienzo - 15 min). Solo con la
   * captura de esa subasta viva y nunca en una abierta a mano.
   */
  private sinNoShows(
    salas: string[],
    e: { startedAt: Date; manualStatus: string | null },
    candidatas: boolean,
    act: Actividad,
    sana: boolean,
    ahora: number,
  ): string[] {
    if (!candidatas || !sana || e.manualStatus === 'live') return salas;
    const inicio = e.startedAt.getTime();
    if (ahora < inicio + CANDIDATE_NO_SHOW_MINUTES * 60_000) return salas;
    const desde = inicio - 15 * 60_000;
    return salas.filter((s) => (act.porSala.get(s) ?? 0) >= desde);
  }

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
      select: { laneCodes: true, endedLanes: true, startedAt: true, manualStatus: true },
    });
    const act = await this.actividad(ahora);
    const sana = ahora - act.ultimaIaai < CAPTURA_SANA_MINUTOS * 60_000;
    // En IAAI todas las lanes son candidatas: la fuente no las trae.
    return entradas.flatMap((e) =>
      this.sinNoShows(e.laneCodes.filter((c) => !e.endedLanes.includes(c)), e, true, act, sana, ahora),
    );
  }

  private async copart(lead: number, ahora: number): Promise<string[]> {
    const entradas = await this.prisma.auctionCalendarEntry.findMany({
      where: { AND: [this.ventana(lead, ahora), { OR: [{ manualStatus: 'live' }, { status: { not: 'ended' } }] }] },
      select: { locationSourceId: true, raw: true, endedLanes: true, startedAt: true, manualStatus: true },
    });
    const act = await this.actividad(ahora);
    const sana = ahora - act.ultimaCopart < CAPTURA_SANA_MINUTOS * 60_000;
    return entradas.flatMap((e) => {
      const salas = copartBroadcastRooms(e.locationSourceId, e.raw).filter((c) => !e.endedLanes.includes(c));
      return this.sinNoShows(salas, e, copartKnownLanes(e.raw).length === 0, act, sana, ahora);
    });
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
  const conocidas = copartKnownLanes(raw);
  const lanes = conocidas.length ? conocidas : COPART_CANDIDATE_LANES;
  return lanes.map((l) => `copart-${locationSourceId}-${l}`);
}

/** Lanes que trae el calendario (lanes, liveLanes, laterLanes), en minuscula y sin repetir. */
export function copartKnownLanes(raw: unknown): string[] {
  const r = (raw ?? {}) as Record<string, Array<{ lane?: string }> | undefined>;
  const lanes = ['lanes', 'liveLanes', 'laterLanes']
    .flatMap((k) => (Array.isArray(r[k]) ? r[k]! : []))
    .map((l) => String(l?.lane ?? '').trim().toLowerCase())
    .filter((l) => /^[a-z]$/.test(l));
  return [...new Set(lanes)];
}
