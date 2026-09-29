/**
 * Deriva un desenlace por cada fila (una "corrida" de subasta) de un mismo
 * VIN. Puramente funcional: no toca Prisma ni HTTP, para poder testearlo sin
 * levantar Nest.
 *
 * IMPORTANTE: la columna `sold` en auction_sale_results siempre viene `true`
 * — bug del ingest — asi que nunca se usa aqui para decidir nada.
 */

export type RunOutcome = 'sold' | 'not_sold' | 'on_approval' | 'reserve_not_met' | 'unknown';

export interface RunOutcomeInput {
  lot: string | number | bigint;
  approved?: boolean | null;
  reserveMet?: boolean | null;
  pendingApproval?: boolean | null;
  finalBid?: number | null;
  highBidAtSync?: number | null;
}

export interface RunOutcomeFields {
  outcome: RunOutcome;
  /** Posicion (1-based) de esta corrida entre las corridas del mismo lote. */
  attempt: number;
  /** Cuantas corridas tiene ese lote en total. */
  lotRuns: number;
  /** `sold` en esta corrida y hay una corrida posterior con OTRO lote. */
  relistedLater: boolean;
  price: number | null;
}

/**
 * `rows` debe venir en orden ascendente por `saleDate` — la funcion no
 * reordena, asume que "posterior" == "mas adelante en el array".
 *
 * Reglas, la primera que aplica gana:
 *  1. existe una corrida POSTERIOR con el mismo lote        -> not_sold
 *  2. approved === true || reserveMet === true               -> sold
 *  3. pendingApproval === true                                -> on_approval
 *  4. reserveMet === false                                    -> reserve_not_met
 *  5. si no                                                   -> unknown
 */
export function deriveRunOutcomes<T extends RunOutcomeInput>(
  rows: readonly T[],
): Array<T & RunOutcomeFields> {
  const key = (lot: T['lot']) => String(lot);

  const lotRunsByKey = new Map<string, number>();
  for (const row of rows) {
    const k = key(row.lot);
    lotRunsByKey.set(k, (lotRunsByKey.get(k) ?? 0) + 1);
  }

  const attemptSoFar = new Map<string, number>();

  return rows.map((row, index) => {
    const k = key(row.lot);
    const attempt = (attemptSoFar.get(k) ?? 0) + 1;
    attemptSoFar.set(k, attempt);
    const lotRuns = lotRunsByKey.get(k) ?? 1;

    const later = rows.slice(index + 1);
    const laterSameLot = later.some((r) => key(r.lot) === k);
    const laterDifferentLot = later.some((r) => key(r.lot) !== k);

    let outcome: RunOutcome;
    if (laterSameLot) {
      outcome = 'not_sold';
    } else if (row.approved === true || row.reserveMet === true) {
      outcome = 'sold';
    } else if (row.pendingApproval === true) {
      outcome = 'on_approval';
    } else if (row.reserveMet === false) {
      outcome = 'reserve_not_met';
    } else {
      outcome = 'unknown';
    }

    const relistedLater = outcome === 'sold' && laterDifferentLot;
    const price = row.finalBid ?? row.highBidAtSync ?? null;

    return { ...row, outcome, attempt, lotRuns, relistedLater, price };
  });
}
