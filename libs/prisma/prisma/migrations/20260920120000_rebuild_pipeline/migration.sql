-- El ciclo completo: embeber lo que falte y, cuando este, reentrenar.
--
-- Hasta ahora eran dos botones que habia que encadenar a mano con horas de
-- espera en medio. El estado va en la base y no en memoria para que un
-- redespliegue a mitad de ciclo no lo pierda.
CREATE TABLE "model_rebuild_runs" (
  "id"            TEXT NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'queued',
  "trigger"       TEXT NOT NULL DEFAULT 'manual',
  "windowDays"    INTEGER NOT NULL,
  "pooling"       TEXT NOT NULL,
  "pcaVersion"    TEXT,
  "lotsTarget"    INTEGER NOT NULL DEFAULT 0,
  "lotsDone"      INTEGER NOT NULL DEFAULT 0,
  "embedRuns"     INTEGER NOT NULL DEFAULT 0,
  "costUsd"       DECIMAL(8,4) NOT NULL DEFAULT 0,
  "trainingRunId" TEXT,
  "startedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"    TIMESTAMP(3),
  "error"         TEXT,
  "log"           TEXT,

  CONSTRAINT "model_rebuild_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "model_rebuild_runs_startedAt_idx" ON "model_rebuild_runs"("startedAt");
CREATE INDEX "model_rebuild_runs_status_idx"    ON "model_rebuild_runs"("status");

-- Una tanda de pod puede pertenecer a un ciclo: entonces sus lotes salen de la
-- ventana del ciclo y no de los filtros de la config.
ALTER TABLE "embed_job_runs"
  ADD COLUMN IF NOT EXISTS "rebuildId" TEXT;

CREATE INDEX IF NOT EXISTS "embed_job_runs_rebuildId_idx" ON "embed_job_runs"("rebuildId");

-- Agrupacion de las fotos de un lote. Cambiarla invalida los vectores ya
-- calculados: mismas 64 dimensiones, otro significado. Arranca en `mean`, que
-- es con lo que se calcularon los 7.870 que ya existen.
ALTER TABLE "embed_job_config"
  ADD COLUMN IF NOT EXISTS "pooling"  TEXT    NOT NULL DEFAULT 'mean',
  ADD COLUMN IF NOT EXISTS "imgSlots" INTEGER NOT NULL DEFAULT 4;

-- Calendario del ciclo automatico. Apagado por defecto: alquila GPUs.
ALTER TABLE "embed_job_config"
  ADD COLUMN IF NOT EXISTS "autoRebuildEnabled"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "autoRebuildEveryDays" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "autoRebuildHour"      INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "lastAutoRebuildAt"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "maxCostUsdPerRebuild" DECIMAL(8,2) NOT NULL DEFAULT 20.0;
