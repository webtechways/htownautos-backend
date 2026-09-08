/**
 * Decodifica los frames de la subasta en vivo de Copart.
 *
 * El camino completo son tres capas, y merece la pena tenerlo escrito porque no
 * se adivina mirando el frame:
 *
 *   1. Frame binario SMF de Solace (`Sec-Websocket-Protocol: smf.solacesystems.com`),
 *      con el topic `auction/outbound/COPART833C` en claro.
 *   2. Dentro, en base64, el sobre: `{ "@class": …MessageEvent, sale, event, data }`.
 *   3. El campo `data` es **otro** base64 con el evento de verdad.
 *
 * Esto vive en el servidor y no en la extension a proposito: es la pieza que mas
 * va a romperse cuando Copart cambie algo, y actualizar diez VMs a mano cuesta
 * mucho mas que un despliegue.
 */

export type AuctionEventType = 'BIDREC' | 'SOLD' | 'OTHER';

export interface DecodedFrame {
  /** Sala, p.ej. `COPART833C`. */
  sale: string | null;
  event: AuctionEventType;
  /** El `event` tal cual venia, aunque no sea uno de los que tratamos. */
  rawEvent: string | null;
  /** Instante en que Copart lo emitio. */
  emittedAt: Date | null;
  /** Numero de lote ya normalizado (sin ceros a la izquierda). */
  lot: string | null;
  itemNo: number | null;
  /**
   * El importe que manda en ese evento. **El campo cambia de nombre segun el
   * tipo**: `CURBID` en una puja, `BID` a secas en una venta. Un parser que
   * busque siempre `CURBID` se come todas las ventas.
   */
  amount: number | null;
  askBid: number | null;
  nextBid: number | null;
  increment: number | null;
  /** Reserva alcanzada (`MINMET`). */
  reserveMet: boolean | null;
  approved: boolean | null;
  buyerNo: string | null;
  /**
   * `BUYERST` no es del mismo tipo siempre: `"NJ"` en compradores de EE.UU.,
   * `"19"` en internacionales. Se guarda como texto tal cual.
   */
  buyerState: string | null;
  buyerCountry: string | null;
  /** El evento decodificado entero, por si aparecen campos nuevos. */
  payload: Record<string, unknown>;
}

/** El sobre lleva siempre un JSON base64 que empieza por `{"@class"`. */
const ENVELOPE_RE = /eyJ[A-Za-z0-9+/=]+/;

function b64json(value: string): any {
  // Se rellena el padding: los trozos recortados del frame lo pierden.
  return JSON.parse(Buffer.from(value + '===', 'base64').toString('utf8'));
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function yn(v: unknown): boolean | null {
  if (typeof v !== 'string' || !v) return null;
  return v.toUpperCase() === 'Y';
}

function str(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
  return s === '' ? null : s;
}

/**
 * Los lotes vienen con ceros a la izquierda (`0062015486`). Sin quitarlos no
 * casan con `auction_listings.lotNumber`, que es un BigInt, y no cruzaria ni uno.
 */
export function normalizeLot(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const digits = s.replace(/\D/g, '').replace(/^0+/, '');
  return digits || null;
}

/**
 * Un vistazo barato para decidir si el frame interesa, sin decodificar nada.
 * Lo usa la extension para no mandar los keepalives de Solace.
 */
export function looksLikeAuctionFrame(raw: string): boolean {
  return raw.includes('auction/outbound') || ENVELOPE_RE.test(raw);
}

/**
 * Decodifica un frame en base64. Devuelve `null` cuando no es un evento de
 * subasta — keepalives y control de Solace pasan por el mismo socket.
 */
export function decodeSolaceFrame(base64Frame: string): DecodedFrame | null {
  let raw: string;
  try {
    raw = Buffer.from(base64Frame, 'base64').toString('binary');
  } catch {
    return null;
  }

  const m = ENVELOPE_RE.exec(raw);
  if (!m) return null;

  let envelope: any;
  try {
    envelope = b64json(m[0]);
  } catch {
    return null;
  }
  if (!envelope || typeof envelope !== 'object' || !envelope.data) return null;

  let payload: any;
  try {
    payload = b64json(envelope.data);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;

  const rawEvent = str(envelope.event);
  const event: AuctionEventType =
    rawEvent === 'BIDREC' || rawEvent === 'SOLD' ? rawEvent : 'OTHER';

  const emit = num(envelope?.metadata?.emitTimestamp);

  return {
    sale: str(envelope.sale),
    event,
    rawEvent,
    emittedAt: emit ? new Date(emit) : null,
    lot: normalizeLot(payload.LOTNO),
    itemNo: num(payload.ITEMNO),
    // Aqui esta el cambio de nombre entre eventos.
    amount: event === 'SOLD' ? num(payload.BID) : num(payload.CURBID),
    askBid: num(payload.ASKBID ?? payload.ASK),
    nextBid: num(payload.NEXT),
    increment: num(payload.INCREMENT),
    reserveMet: yn(payload.MINMET),
    approved: yn(payload.APRFLG),
    buyerNo: str(payload.BUYERNO),
    buyerState: str(payload.BUYERST),
    buyerCountry: str(payload.BUYERCTR),
    payload,
  };
}
