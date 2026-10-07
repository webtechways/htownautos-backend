/**
 * Decodifica los mensajes del socket de difusion de AutoBidMaster
 * (`wss://broadcast.autobidmaster.com/socket`).
 *
 * A diferencia del socket de sala (Solace, binario, tres capas de base64), este
 * es Socket.IO en texto y llega YA estructurado:
 *
 *   42["event",{"auction":"copart-880-a","lot":56827376,"bid":4300,
 *               "country":"us","order":2,"asking":4350,"reserve":false,
 *               "sold":false,"ticks":10,"round":1}]
 *
 *   - `42` = paquete de evento de Socket.IO. `2`/`3` son ping/pong y no llegan
 *     aqui (la extension no los manda).
 *   - `order` es el numero de puja dentro del lote; `order: 1` sin `country` es
 *     la apertura (la puja previa mas alta con la que arranca el remate).
 *   - `round` sube cuando el subastador repite la misma puja ("a la de dos");
 *     el importe y el `order` no cambian, asi que es la misma puja.
 *   - `sold: true` cierra el lote con `bid` como importe final.
 *
 * No trae instante de emision: se usa el de captura que manda la extension.
 *
 * Devuelve la misma forma que `decodeSolaceFrame` para que el consumidor
 * guarde las dos fuentes con el mismo codigo.
 */
import { type AuctionEventType, type DecodedFrame, normalizeLot } from './solace-frame.decoder';

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * `copart-880-a` → `COPART880A`, que es como llama a la sala el socket de
 * Solace. Con el mismo nombre las dos fuentes cuentan como la misma sala en el
 * Live Feed y en las estadisticas.
 */
export function normalizeBroadcastRoom(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  return v.replace(/[^a-z0-9]/gi, '').toUpperCase() || null;
}

/** Saca `[nombre, datos]` de un paquete de evento de Socket.IO. */
export function parseSocketIoEvent(message: string): { name: string; data: unknown } | null {
  const m = /^\d*(\[[\s\S]*\])$/.exec(message.trim());
  if (!m || !message.trim().startsWith('42')) return null;
  try {
    const arr = JSON.parse(m[1]);
    if (!Array.isArray(arr) || typeof arr[0] !== 'string') return null;
    return { name: arr[0], data: arr[1] };
  } catch {
    return null;
  }
}

/**
 * Decodifica un mensaje de difusion. `null` si no es un paquete de evento.
 *
 * Un evento con otro nombre que `event`, o sin lote, sale como `OTHER`: el
 * consumidor lo guarda como `ignored` con sus datos, que es lo que hace falta
 * para decidir mas adelante que hacer con el.
 */
export function decodeBroadcastMessage(message: string, capturedAt: Date | null): DecodedFrame | null {
  const pkt = parseSocketIoEvent(message);
  if (!pkt) return null;

  const d = (pkt.data && typeof pkt.data === 'object' ? pkt.data : {}) as Record<string, unknown>;
  const lot = normalizeLot(d.lot);
  const country = typeof d.country === 'string' && d.country ? d.country.toUpperCase() : null;

  let event: AuctionEventType = 'OTHER';
  if (pkt.name === 'event' && lot) {
    if (d.sold === true) event = 'SOLD';
    // La apertura: la puja con la que arranca el lote no es de nadie en sala.
    else if (num(d.order) === 1 && !country) event = 'PREBID';
    else event = 'BIDREC';
  }

  const bid = num(d.bid);
  const asking = num(d.asking);

  return {
    sale: normalizeBroadcastRoom(d.auction),
    event,
    // El mismo nombre que en el socket de sala, para que el Live Feed y sus
    // filtros los traten igual. De que fuente vino lo dice `source` en la fila.
    rawEvent: event !== 'OTHER' ? event : pkt.name,
    emittedAt: capturedAt,
    lot,
    itemNo: null,
    amount: bid,
    askBid: asking,
    nextBid: asking,
    increment: bid != null && asking != null ? asking - bid : null,
    // `reserve` no esta claro todavia que signifique lo mismo que `MINMET`; se
    // conserva en `payload` y no se interpreta hasta confirmarlo con datos.
    reserveMet: null,
    approved: null,
    buyerNo: null,
    buyerState: null,
    buyerCountry: country,
    payload: { ...d, _event: pkt.name },
  };
}
