/**
 * Jumping Table: cuanto sube cada puja en sala segun el precio actual.
 *
 * En la subasta en vivo no se puede pujar cualquier cifra: cada puja sube un
 * salto fijo que depende del tramo de precio. Medido en produccion
 * (2026-10-07, 312k pujas consecutivas): el 99,39% sube exactamente un salto.
 * Por eso, con el precio inicial y el NUMERO de pujas, se reconstruye el
 * precio final sin conocer ningun importe (94,9% exacto en 18k lotes).
 *
 * Las tablas son editables en Ajustes → Jumping Tables; estas son la semilla
 * y el valor de reserva si la base no tiene filas.
 */

export interface BidIncrementRow {
  /** Desde este precio (incluido) se aplica `increment`. */
  fromPrice: number;
  increment: number;
}

/** Deducida de 330k pujas reales de Copart (BIDREC, 2026-10-04 → 07). */
export const DEFAULT_COPART_BID_INCREMENTS: BidIncrementRow[] = [
  { fromPrice: 0, increment: 1 },
  { fromPrice: 5, increment: 5 },
  { fromPrice: 40, increment: 10 },
  { fromPrice: 100, increment: 25 },
  { fromPrice: 1000, increment: 50 },
  { fromPrice: 5000, increment: 100 },
  { fromPrice: 25000, increment: 250 },
  { fromPrice: 50000, increment: 500 },
  { fromPrice: 100000, increment: 1000 },
];

/**
 * IAAI (salas iaa-*, SalvageBid), deducida de 95k pujas reales (asking - bid,
 * 2026-10-07 → 08). Cada tramo empieza justo donde aparece su salto por
 * primera vez ($500, $1.000, $10.000, $50.000). El 74,2% de las pujas sigue
 * esta tabla exacta; el 25,8% restante es un salto reducido del subastador (la
 * mitad, o 100 en el tramo de 250) y ninguna otra cosa. Por eso, en IAAI, el
 * precio reconstruido por numero de pujas es un maximo, no un exacto.
 * Por encima de $121.000 se vieron 8 pujas de +$1.000: pocas para fijar tramo.
 */
export const DEFAULT_IAAI_BID_INCREMENTS: BidIncrementRow[] = [
  { fromPrice: 0, increment: 25 },
  { fromPrice: 500, increment: 50 },
  { fromPrice: 1000, increment: 100 },
  { fromPrice: 10000, increment: 250 },
  { fromPrice: 50000, increment: 500 },
];

export const BID_INCREMENT_AUCTIONS = ['copart', 'iaai'] as const;
export type BidIncrementAuction = (typeof BID_INCREMENT_AUCTIONS)[number];

/** La semilla de cada subasta. */
export function defaultBidIncrements(auction: string): BidIncrementRow[] {
  return auction === 'iaai' ? DEFAULT_IAAI_BID_INCREMENTS : DEFAULT_COPART_BID_INCREMENTS;
}

/** Ordena por `fromPrice` y descarta filas sin sentido. */
export function normalizeBidIncrements(rows: BidIncrementRow[]): BidIncrementRow[] {
  return rows
    .filter((r) => Number.isFinite(r.fromPrice) && r.fromPrice >= 0 && Number.isFinite(r.increment) && r.increment > 0)
    .sort((a, b) => a.fromPrice - b.fromPrice);
}

/**
 * Por que se rechaza una tabla, o `null` si vale. Se valida igual en el
 * servidor y en la pantalla para que el error se vea antes de guardar.
 */
export function validateBidIncrements(rows: BidIncrementRow[]): string | null {
  if (!rows.length) return 'La tabla no puede estar vacia';
  const vistos = new Set<number>();
  for (const r of rows) {
    if (!Number.isFinite(r.fromPrice) || r.fromPrice < 0) return `Precio "desde" invalido: ${r.fromPrice}`;
    if (!Number.isFinite(r.increment) || r.increment <= 0) return `El salto debe ser mayor que 0 (desde ${r.fromPrice})`;
    if (vistos.has(r.fromPrice)) return `Tramo repetido: desde ${r.fromPrice}`;
    vistos.add(r.fromPrice);
  }
  if (!vistos.has(0)) return 'Tiene que haber un tramo que empiece en 0';
  return null;
}

/** El salto que toca a un precio: el del ultimo tramo cuyo `fromPrice` <= precio. */
export function incrementFor(rows: BidIncrementRow[], price: number): number {
  const tabla = normalizeBidIncrements(rows);
  let inc = tabla[0]?.increment ?? 1;
  for (const r of tabla) {
    if (price >= r.fromPrice) inc = r.increment;
    else break;
  }
  return inc;
}

/**
 * Precio tras `bids` pujas contando la inicial como la primera.
 *
 * `simulateFinalPrice(1000, 3)` = 1000 → 1050 → 1100. Si se perdio alguna
 * puja el resultado queda un salto por debajo por cada una.
 */
export function simulateFinalPrice(startPrice: number, bids: number, rows: BidIncrementRow[]): number {
  let p = startPrice;
  for (let i = 1; i < bids; i++) p += incrementFor(rows, p);
  return p;
}
