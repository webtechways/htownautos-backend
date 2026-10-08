/**
 * Estado de una subasta del calendario (Copart e IAAI) y fin por ENDAUC.
 *
 * Prioridad del estado efectivo:
 *   1. `manualStatus` — lo puso una persona; gana siempre.
 *   2. `endedAt` (todas las lanes mandaron ENDAUC) o el calendario la da por
 *      terminada → ended.
 *   3. Por hora: upcoming hasta 15 min antes del comienzo, live hasta 8 h
 *      despues, luego ended.
 */

export type CalendarStatus = 'live' | 'upcoming' | 'ended';
export const CALENDAR_STATUSES: CalendarStatus[] = ['live', 'upcoming', 'ended'];

/** Sin hora de fin: la lane mas larga vista dura 2-3 h, 8 h cubre de sobra. */
export const CALENDAR_LIVE_HOURS = 8;

/**
 * Una subasta cuenta como en vivo desde estos minutos antes de su comienzo:
 * es cuando las VMs tienen que estar ya suscritas (lo mismo que `leadMinutes`
 * de /broadcast/live-rooms).
 */
export const CALENDAR_LIVE_LEAD_MINUTES = 15;

export function timeStatus(startedAt: Date, now = Date.now()): CalendarStatus {
  const t = startedAt.getTime();
  if (now < t - CALENDAR_LIVE_LEAD_MINUTES * 60_000) return 'upcoming';
  return now < t + CALENDAR_LIVE_HOURS * 3_600_000 ? 'live' : 'ended';
}

export function effectiveCalendarStatus(
  e: { startedAt: Date; manualStatus?: string | null; endedAt?: Date | null; status?: string | null },
  now = Date.now(),
): CalendarStatus {
  if (e.manualStatus && (CALENDAR_STATUSES as string[]).includes(e.manualStatus)) return e.manualStatus as CalendarStatus;
  if (e.endedAt || e.status === 'ended') return 'ended';
  return timeStatus(e.startedAt, now);
}

/**
 * Codigo de sala del socket de difusion a partir de lo que trae un evento:
 *   sala Solace `COPART159E` → `copart-159-e`
 *   sala IAAI   `IAA441E`    → `iaa-441-e`
 *   difusion    `copart-194-d` / `iaa-643-c` → tal cual (en minuscula)
 * Sede sin ceros a la izquierda: copart-25-a responde en el socket, copart-025-a no.
 */
export function roomCodeOf(...candidates: Array<unknown>): string | null {
  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    const v = c.trim();
    const diff = /^(copart|iaa)-0*(\d+)-([a-z0-9])$/i.exec(v);
    if (diff) return `${diff[1].toLowerCase()}-${Number(diff[2])}-${diff[3].toLowerCase()}`;
    const sala = /^(COPART|IAA)0*(\d+)([A-Z0-9])$/i.exec(v);
    if (sala) return `${sala[1].toLowerCase() === 'copart' ? 'copart' : 'iaa'}-${Number(sala[2])}-${sala[3].toLowerCase()}`;
  }
  return null;
}

/** Lanes de una subasta de Copart (raw.lanes del calendario) como codigos de sala. */
export function copartLaneCodes(locationSourceId: number, raw: unknown): string[] {
  const lanes = (raw as { lanes?: Array<{ lane?: string }> } | null)?.lanes ?? [];
  const out: string[] = [];
  for (const l of lanes) {
    const lane = String(l?.lane ?? '').trim().toLowerCase();
    if (/^[a-z]$/.test(lane)) out.push(`copart-${locationSourceId}-${lane}`);
  }
  return [...new Set(out)];
}

type Db = any; // PrismaService (los getters pierden la firma generica)

export interface RoomEndResult {
  auction: 'copart' | 'iaai';
  entryId: string;
  room: string;
  /** Ya no queda ninguna lane activa: la subasta entera paso a ended. */
  auctionEnded: boolean;
}

/**
 * Un ENDAUC de `room`: se apunta la lane en la subasta de ese dia y, si ya
 * terminaron todas, la subasta entera queda ended (y en Copart tambien la
 * columna `status`, que es la que miran agentes, VMs y avisos).
 *
 * Que lanes cuentan:
 *   Copart — las del calendario (raw.lanes).
 *   IAAI   — las candidatas no son reales (iaa-643-a…h), asi que cuentan las
 *            que tuvieron pujas desde una hora antes del comienzo.
 * Un estado manual no se toca: lo decidio una persona.
 */
export async function markRoomEnded(prisma: Db, room: string, at: Date = new Date()): Promise<RoomEndResult | null> {
  const m = /^(copart|iaa)-(\d+)-([a-z0-9])$/.exec(room);
  if (!m) return null;
  const sede = Number(m[2]);
  const desde = new Date(at.getTime() - 14 * 3_600_000);
  const hasta = new Date(at.getTime() + 30 * 60_000);

  if (m[1] === 'copart') {
    const e = await prisma.auctionCalendarEntry.findFirst({
      where: { locationSourceId: sede, startedAt: { gte: desde, lte: hasta } },
      orderBy: { startedAt: 'desc' },
      select: { id: true, raw: true, endedLanes: true, endedAt: true, manualStatus: true },
    });
    if (!e) return null;
    const ended = [...new Set([...(e.endedLanes ?? []), room])];
    const lanes = copartLaneCodes(sede, e.raw);
    // Sin lanes conocidas no se cierra la subasta entera por la primera: solo esa lane.
    const todas = lanes.length > 0 && lanes.every((l) => ended.includes(l));
    await prisma.auctionCalendarEntry.update({
      where: { id: e.id },
      data: {
        endedLanes: ended,
        ...(todas && !e.endedAt ? { endedAt: at } : {}),
        ...(todas && !e.manualStatus ? { status: 'ended' } : {}),
      },
    });
    return { auction: 'copart', entryId: e.id, room, auctionEnded: todas };
  }

  const e = await prisma.iaaiCalendarEntry.findFirst({
    where: { branchNumber: sede, startedAt: { gte: desde, lte: hasta } },
    orderBy: { startedAt: 'desc' },
    select: { id: true, startedAt: true, endedLanes: true, endedAt: true },
  });
  if (!e) return null;
  const ended = [...new Set([...(e.endedLanes ?? []), room])];
  const inicio = new Date(e.startedAt.getTime() - 3_600_000);
  const patron = `iaa-${sede}-%`;
  const activas: Array<{ room: string }> = await prisma.$queryRaw`
    SELECT DISTINCT room FROM iaai_bid_events WHERE room LIKE ${patron} AND "firstSeenAt" >= ${inicio}
    UNION
    SELECT DISTINCT room FROM bid_no_price_iaai WHERE room LIKE ${patron} AND "firstSeenAt" >= ${inicio}`;
  const lanes = activas.map((r) => r.room);
  const todas = lanes.length > 0 && lanes.every((l) => ended.includes(l));
  await prisma.iaaiCalendarEntry.update({
    where: { id: e.id },
    data: { endedLanes: ended, ...(todas && !e.endedAt ? { endedAt: at } : {}) },
  });
  return { auction: 'iaai', entryId: e.id, room, auctionEnded: todas };
}

// ── Fin automatico por inactividad ─────────────────────────────────────────

/** Una lane con actividad que lleva esto sin eventos, con la captura sana, terminó. */
export const LANE_IDLE_MINUTES = 20;
/** Si la captura parece caida (nada en ninguna sala), se espera mucho mas. */
export const LANE_IDLE_UNHEALTHY_MINUTES = 90;
/** La captura esta sana si alguna sala tuvo un evento hace menos de esto. */
export const CAPTURE_HEALTHY_MINUTES = 10;
/** Lane del calendario sin ningun evento tanto despues del comienzo: no corrio (o no se capto). */
export const LANE_NO_SHOW_HOURS = 3;

/**
 * Pura: que lanes de una subasta han terminado ya, dada la ultima actividad de
 * cada sala. `lanes` = las conocidas (Copart: calendario; IAAI: las que
 * tuvieron pujas). Devuelve las nuevas terminadas y si ya no queda ninguna viva.
 */
export function idleLanes(opts: {
  lanes: string[];
  alreadyEnded: string[];
  lastActivity: Map<string, Date>;
  startedAt: Date;
  now: number;
  captureHealthy: boolean;
}): { newlyEnded: string[]; allEnded: boolean; lastAt: Date | null } {
  const idle = (opts.captureHealthy ? LANE_IDLE_MINUTES : LANE_IDLE_UNHEALTHY_MINUTES) * 60_000;
  const newlyEnded: string[] = [];
  let lastAt: Date | null = null;
  for (const lane of opts.lanes) {
    const last = opts.lastActivity.get(lane);
    if (last && (!lastAt || last > lastAt)) lastAt = last;
    if (opts.alreadyEnded.includes(lane)) continue;
    const done = last
      ? opts.now - last.getTime() > idle
      : opts.now - opts.startedAt.getTime() > LANE_NO_SHOW_HOURS * 3_600_000;
    if (done) newlyEnded.push(lane);
  }
  const ended = new Set([...opts.alreadyEnded, ...newlyEnded]);
  const allEnded = opts.lanes.length > 0 && opts.lanes.every((l) => ended.has(l));
  return { newlyEnded, allEnded, lastAt };
}

/**
 * Pasa a terminadas las lanes y subastas que dejaron de tener actividad (el
 * socket no avisa del fin). Se ejecuta cada pocos minutos. No toca nada con
 * estado manual. Devuelve cuantas subastas termino.
 */
export async function autoEndIdleAuctions(prisma: Db, now = Date.now()): Promise<{ lanes: number; auctions: number }> {
  const desde = new Date(now - 14 * 3_600_000);
  const filas: Array<{ room: string | null; last: Date | null }> = await prisma.$queryRaw`
    SELECT room, max("lastSeenAt") AS last FROM bid_no_price WHERE "firstSeenAt" >= ${desde} GROUP BY room
    UNION ALL
    SELECT "saleRoom" AS room, max("emittedAt") AS last FROM auction_bid_events
     WHERE "emittedAt" >= ${desde} AND "saleRoom" IS NOT NULL GROUP BY "saleRoom"
    UNION ALL
    SELECT room, max("lastSeenAt") AS last FROM iaai_bid_events WHERE "firstSeenAt" >= ${desde} GROUP BY room
    UNION ALL
    SELECT room, max("lastSeenAt") AS last FROM bid_no_price_iaai WHERE "firstSeenAt" >= ${desde} GROUP BY room`;

  // Sala normalizada (copart-159-e / iaa-643-c) → ultimo evento.
  const actividad = new Map<string, Date>();
  let global = 0;
  for (const f of filas) {
    const code = roomCodeOf(f.room);
    if (!code || !f.last) continue;
    const t = new Date(f.last);
    if (!actividad.has(code) || t > actividad.get(code)!) actividad.set(code, t);
    global = Math.max(global, t.getTime());
  }
  const captureHealthy = global > 0 && now - global < CAPTURE_HEALTHY_MINUTES * 60_000;
  const activasDe = (prefijo: string) => [...actividad.keys()].filter((k) => k.startsWith(prefijo));

  const ventana = {
    manualStatus: null,
    endedAt: null,
    startedAt: { gte: desde, lte: new Date(now - LANE_IDLE_MINUTES * 60_000) },
  };
  let lanes = 0;
  let auctions = 0;

  const copart: Array<{ id: string; locationSourceId: number; raw: unknown; endedLanes: string[]; startedAt: Date }> =
    await prisma.auctionCalendarEntry.findMany({
      where: { ...ventana, status: { not: 'ended' } },
      select: { id: true, locationSourceId: true, raw: true, endedLanes: true, startedAt: true },
    });
  for (const e of copart) {
    const conocidas = new Set([...copartLaneCodes(e.locationSourceId, e.raw), ...activasDe(`copart-${e.locationSourceId}-`)]);
    const r = idleLanes({
      lanes: [...conocidas],
      alreadyEnded: e.endedLanes,
      lastActivity: actividad,
      startedAt: e.startedAt,
      now,
      captureHealthy,
    });
    if (!r.newlyEnded.length && !r.allEnded) continue;
    lanes += r.newlyEnded.length;
    if (r.allEnded) auctions++;
    await prisma.auctionCalendarEntry.update({
      where: { id: e.id },
      data: {
        endedLanes: [...new Set([...e.endedLanes, ...r.newlyEnded])],
        ...(r.allEnded ? { endedAt: r.lastAt ?? new Date(now), status: 'ended' } : {}),
      },
    });
  }

  const iaai: Array<{ id: string; branchNumber: number; endedLanes: string[]; startedAt: Date }> =
    await prisma.iaaiCalendarEntry.findMany({
      where: ventana,
      select: { id: true, branchNumber: true, endedLanes: true, startedAt: true },
    });
  for (const e of iaai) {
    // Las candidatas (iaa-643-a…h) no son reales: cuentan solo las que tuvieron pujas.
    const r = idleLanes({
      lanes: activasDe(`iaa-${e.branchNumber}-`),
      alreadyEnded: e.endedLanes,
      lastActivity: actividad,
      startedAt: e.startedAt,
      now,
      captureHealthy,
    });
    if (!r.newlyEnded.length && !r.allEnded) continue;
    lanes += r.newlyEnded.length;
    if (r.allEnded) auctions++;
    await prisma.iaaiCalendarEntry.update({
      where: { id: e.id },
      data: {
        endedLanes: [...new Set([...e.endedLanes, ...r.newlyEnded])],
        ...(r.allEnded ? { endedAt: r.lastAt ?? new Date(now) } : {}),
      },
    });
  }
  return { lanes, auctions };
}

/**
 * Pone en `live` la columna `status` de las subastas de Copart que empiezan
 * en los proximos 15 min (o ya empezaron), sin esperar al siguiente scrape del
 * calendario: la hora ya la sabemos. Respeta lo manual y lo ya terminado.
 * Las de mas de 8 h pasan a ended por el mismo motivo.
 */
export async function promoteCalendarByTime(prisma: Db, now = Date.now()): Promise<{ live: number; ended: number }> {
  const hasta = new Date(now + CALENDAR_LIVE_LEAD_MINUTES * 60_000);
  const caduca = new Date(now - CALENDAR_LIVE_HOURS * 3_600_000);
  const live = await prisma.auctionCalendarEntry.updateMany({
    where: { manualStatus: null, endedAt: null, status: { notIn: ['live', 'ended'] }, startedAt: { lte: hasta, gt: caduca } },
    data: { status: 'live' },
  });
  const ended = await prisma.auctionCalendarEntry.updateMany({
    where: { manualStatus: null, status: { not: 'ended' }, startedAt: { lte: caduca } },
    data: { status: 'ended' },
  });
  return { live: live.count, ended: ended.count };
}
