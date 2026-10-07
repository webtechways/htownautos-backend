/**
 * Calendario de subastas de IAAI a partir de https://www.iaai.com/branchlocations.
 *
 * La pagina embebe un JSON en `<script type="application/json" id="locationsListVM">`
 * con `$values`: una entrada por sede (201) y, en cada una, su PROXIMA subasta:
 *
 *   branchNumber "643" · name "Manchester" · auctionId "180132~US"
 *   auctionDateTime "2026-10-07T13:30:00+00:00" (UTC) · numberOfVehicles 311
 *   auctionSchedule "Every Wednesday at 9:30 a.m. ET"
 *
 * No trae lanes. El socket de difusion de SalvageBid nombra las salas
 * `iaa-{branchNumber}-{lane}` (iaa-643-c = Manchester, lane C), asi que se
 * generan los candidatos a, b, c…: una lane que no existe simplemente no
 * responde al suscribirse.
 */

export interface IaaiCalendarRow {
  auctionId: string;
  branchNumber: number;
  branchName: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
  startedAt: Date;
  /** YYYYMMDD en hora de Houston. */
  saleDate: number;
  numberOfVehicles: number;
  auctionSchedule: string | null;
  publicAuction: boolean;
  isBranchVirtual: boolean;
  laneCodes: string[];
  raw: Record<string, unknown>;
}

const LANES = 'abcdefghijklmnopqrstuvwxyz';

/** `iaa-643-a`, `iaa-643-b`… */
export function iaaiLaneCodes(branchNumber: number, lanes: number): string[] {
  const n = Math.max(1, Math.min(LANES.length, Math.floor(lanes) || 1));
  return [...LANES.slice(0, n)].map((l) => `iaa-${branchNumber}-${l}`);
}

/** YYYYMMDD en hora de Houston, como `AuctionCalendarEntry.saleDate`. */
export function houstonYmd(at: Date): number {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
  return Number(p.replace(/-/g, ''));
}

/** Saca el JSON embebido. Lanza si la pagina cambio y ya no esta. */
export function extractIaaiLocationsJson(html: string): Array<Record<string, any>> {
  // Imperva (Incapsula) responde 200 con una pagina de ~1 KB que solo trae su
  // desafio. No se intenta resolver: se informa para verlo en la pantalla.
  if (/_Incapsula_Resource|Incapsula incident ID/i.test(html)) {
    const id = /incident(?:_| )ID:?\s*([\d-]+)/i.exec(html)?.[1];
    throw new Error(`branchlocations: bloqueado por Imperva (Incapsula)${id ? `, incident ${id}` : ''}`);
  }
  const m = /<script[^>]*id="locationsListVM"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('branchlocations: no se encontro <script id="locationsListVM"> (la pagina cambio)');
  const json = JSON.parse(m[1]);
  const values = Array.isArray(json) ? json : json?.$values;
  if (!Array.isArray(values)) throw new Error('branchlocations: locationsListVM sin $values');
  return values;
}

const txt = (v: unknown) => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
  return s === '' ? null : s;
};
const num = (v: unknown) => {
  const n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) ? n : null;
};

/**
 * Una fila por sede con subasta programada. Las sedes sin `auctionId` o sin
 * fecha (11 de 201 el 2026-10-07: sobre todo virtuales) se descartan.
 */
export function parseIaaiBranchCalendar(html: string, lanesPerBranch = 8): IaaiCalendarRow[] {
  const out: IaaiCalendarRow[] = [];
  for (const b of extractIaaiLocationsJson(html)) {
    const branchNumber = num(b.branchNumber);
    const auctionId = txt(b.auctionId);
    const when = txt(b.auctionDateTime);
    const startedAt = when ? new Date(when) : null;
    if (!branchNumber || !auctionId || !startedAt || Number.isNaN(startedAt.getTime())) continue;

    // El JSON trae metadatos de serializacion ($id) y campos enormes de texto
    // que no aportan; se guarda lo util para poder reinterpretarlo despues.
    const { $id: _id, branchImages: _imgs, ...raw } = b;
    out.push({
      auctionId,
      branchNumber,
      branchName: txt(b.name) ?? `IAAI ${branchNumber}`,
      city: txt(b.city),
      state: txt(b.state),
      zip: txt(b.zip),
      latitude: num(b.latitude),
      longitude: num(b.longitude),
      startedAt,
      saleDate: houstonYmd(startedAt),
      numberOfVehicles: num(b.numberOfVehicles) ?? 0,
      auctionSchedule: txt(b.auctionSchedule),
      publicAuction: b.publicAuction === true,
      isBranchVirtual: b.isBranchVirtual === true,
      laneCodes: iaaiLaneCodes(branchNumber, lanesPerBranch),
      raw,
    });
  }
  return out;
}
