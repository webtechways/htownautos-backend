/**
 * Estado de una subasta del calendario (Copart e IAAI) y fin por ENDAUC.
 *
 * Prioridad del estado efectivo:
 *   1. `manualStatus` — lo puso una persona; gana siempre.
 *   2. `endedAt` (todas las lanes mandaron ENDAUC) o el calendario la da por
 *      terminada → ended.
 *   3. Por hora: antes del comienzo upcoming, hasta 8 h despues live, luego ended.
 */

export type CalendarStatus = 'live' | 'upcoming' | 'ended';
export const CALENDAR_STATUSES: CalendarStatus[] = ['live', 'upcoming', 'ended'];

/** Sin hora de fin: la lane mas larga vista dura 2-3 h, 8 h cubre de sobra. */
export const CALENDAR_LIVE_HOURS = 8;

export function timeStatus(startedAt: Date, now = Date.now()): CalendarStatus {
  const t = startedAt.getTime();
  if (now < t) return 'upcoming';
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
