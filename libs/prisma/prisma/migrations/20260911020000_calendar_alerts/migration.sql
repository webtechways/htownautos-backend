-- Avisos por chat antes de que empiece una subasta del calendario.

-- Deduplicacion del aviso. Se preserva en el refresco del calendario (que
-- borra y recrea todas las filas) igual que `monitor` y `scraperAgentId`: sin
-- eso, cada refresco reavisaria de las mismas subastas.
ALTER TABLE "auction_calendar_entries" ADD COLUMN "alertedAt" TIMESTAMP(3);

-- Es exactamente lo que consulta el cron: proximas y aun sin avisar.
CREATE INDEX "auction_calendar_entries_startedAt_alertedAt_idx"
  ON "auction_calendar_entries"("startedAt", "alertedAt");

-- Configuracion, en el singleton que ya gobierna el refresco.
ALTER TABLE "auction_calendar_config"
  ADD COLUMN "alertsEnabled"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "alertMinutesBefore" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "alertChannelIds"    TEXT[]  NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "alertOnlyWithAgent" BOOLEAN NOT NULL DEFAULT true;
