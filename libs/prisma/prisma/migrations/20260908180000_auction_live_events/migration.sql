-- Datos que solo trae el frame de Solace y que el esquema anterior no recogia.
ALTER TABLE "auction_sale_results"
  ADD COLUMN "saleRoom"     TEXT,
  ADD COLUMN "reserveMet"   BOOLEAN,
  ADD COLUMN "approved"     BOOLEAN,
  ADD COLUMN "buyerNo"      TEXT,
  ADD COLUMN "buyerState"   TEXT,
  ADD COLUMN "buyerCountry" TEXT,
  ADD COLUMN "itemNo"       INTEGER,
  ADD COLUMN "emittedAt"    TIMESTAMP(3);

CREATE INDEX "auction_sale_results_saleRoom_idx" ON "auction_sale_results"("saleRoom");

-- Cada puja de una subasta en vivo (BIDREC).
--
-- Tabla aparte a proposito: un lote tiene UNA venta pero MUCHAS pujas, y
-- auction_sale_results es unica por (lot, saleDate).
CREATE TABLE "auction_bid_events" (
  "id"           TEXT NOT NULL,
  "lot"          BIGINT NOT NULL,
  "saleRoom"     TEXT,
  "itemNo"       INTEGER,
  "bid"          DECIMAL(12,2),
  "askBid"       DECIMAL(12,2),
  "nextBid"      DECIMAL(12,2),
  "increment"    DECIMAL(12,2),
  "reserveMet"   BOOLEAN,
  "approved"     BOOLEAN,
  "buyerNo"      TEXT,
  "buyerState"   TEXT,
  "buyerCountry" TEXT,
  "emittedAt"    TIMESTAMP(3),
  "receivedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "raw"          JSONB,
  CONSTRAINT "auction_bid_events_pkey" PRIMARY KEY ("id")
);

-- Idempotencia: el mismo evento reenviado por dos VM no duplica fila.
CREATE UNIQUE INDEX "auction_bid_events_lot_emittedAt_bid_key"
  ON "auction_bid_events"("lot", "emittedAt", "bid");
CREATE INDEX "auction_bid_events_lot_idx"       ON "auction_bid_events"("lot");
CREATE INDEX "auction_bid_events_saleRoom_idx"  ON "auction_bid_events"("saleRoom");
CREATE INDEX "auction_bid_events_emittedAt_idx" ON "auction_bid_events"("emittedAt");

-- Frame crudo tal como llego. Es lo que permite reprocesar el pasado cuando se
-- descubre que un campo que hoy ignoramos significa algo.
CREATE TABLE "auction_raw_frames" (
  "id"          TEXT NOT NULL,
  "frame"       TEXT NOT NULL,
  "worker"      TEXT,
  "status"      TEXT NOT NULL DEFAULT 'pending',
  "event"       TEXT,
  "lot"         BIGINT,
  "error"       TEXT,
  "receivedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "auction_raw_frames_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "auction_raw_frames_status_idx"     ON "auction_raw_frames"("status");
CREATE INDEX "auction_raw_frames_receivedAt_idx" ON "auction_raw_frames"("receivedAt");
CREATE INDEX "auction_raw_frames_lot_idx"        ON "auction_raw_frames"("lot");
