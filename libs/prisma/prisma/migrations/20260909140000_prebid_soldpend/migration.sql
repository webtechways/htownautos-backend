-- PREBID pasa a guardarse como puja, y SOLDPEND como resultado de venta
-- provisional: adjudicada pero a la espera de que el vendedor acepte la puja.

-- Todo lo que hay hasta ahora es BIDREC.
ALTER TABLE "auction_bid_events" ADD COLUMN "eventType" TEXT NOT NULL DEFAULT 'BIDREC';
CREATE INDEX "auction_bid_events_eventType_idx" ON "auction_bid_events"("eventType");

-- El tipo entra en la clave de idempotencia: una PREBID y una BIDREC pueden
-- coincidir en instante e importe y son eventos distintos.
DROP INDEX IF EXISTS "auction_bid_events_lot_emittedAt_bid_key";
CREATE UNIQUE INDEX "auction_bid_events_lot_eventType_emittedAt_bid_key"
  ON "auction_bid_events"("lot", "eventType", "emittedAt", "bid");

-- Un SOLD posterior del mismo lote confirma la venta y pone esto a false.
ALTER TABLE "auction_sale_results" ADD COLUMN "pendingApproval" BOOLEAN;
CREATE INDEX "auction_sale_results_pendingApproval_idx"
  ON "auction_sale_results"("pendingApproval");
