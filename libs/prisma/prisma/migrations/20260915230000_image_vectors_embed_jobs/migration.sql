-- Vectores de imagen por lote + el job nocturno que los produce.
--
-- Tres tablas nuevas, ninguna toca nada existente: se pueden aplicar en caliente.

-- Las fotos de un lote convertidas a numeros. Append-only: las fotos no cambian,
-- asi que un lote embebido esta resuelto para siempre.
CREATE TABLE "lot_image_vectors" (
  "lotNumber"  BIGINT NOT NULL,
  "vector"     BYTEA NOT NULL,
  "dims"       INTEGER NOT NULL,
  "encoder"    TEXT NOT NULL,
  "pcaVersion" TEXT NOT NULL,
  "imageCount" INTEGER NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "lot_image_vectors_pkey" PRIMARY KEY ("lotNumber")
);

CREATE INDEX "lot_image_vectors_createdAt_idx" ON "lot_image_vectors"("createdAt");
CREATE INDEX "lot_image_vectors_encoder_pcaVersion_idx"
  ON "lot_image_vectors"("encoder", "pcaVersion");

-- Registro contable de cada ejecucion: que pod, cuanto costo y quien lo apago.
CREATE TABLE "embed_job_runs" (
  "id"            TEXT NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'pending',
  "podId"         TEXT,
  "podType"       TEXT,
  "costPerHr"     DECIMAL(8,4),
  "costUsd"       DECIMAL(8,4),
  "gpuSeconds"    INTEGER,
  "startedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "podReadyAt"    TIMESTAMP(3),
  "finishedAt"    TIMESTAMP(3),
  "terminatedAt"  TIMESTAMP(3),
  "terminatedBy"  TEXT,
  "lotsRequested" INTEGER NOT NULL DEFAULT 0,
  "lotsDone"      INTEGER NOT NULL DEFAULT 0,
  "imagesDone"    INTEGER NOT NULL DEFAULT 0,
  "imagesFailed"  INTEGER NOT NULL DEFAULT 0,
  "error"         TEXT,
  "log"           TEXT,

  CONSTRAINT "embed_job_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "embed_job_runs_startedAt_idx" ON "embed_job_runs"("startedAt");
CREATE INDEX "embed_job_runs_status_idx" ON "embed_job_runs"("status");

-- Ajustes editables desde Auction Data. Arranca DESACTIVADO: encenderlo alquila
-- GPUs, asi que es una decision explicita y no un efecto del despliegue.
CREATE TABLE "embed_job_config" (
  "id"               TEXT NOT NULL DEFAULT 'singleton',
  "enabled"          BOOLEAN NOT NULL DEFAULT false,
  "cronHour"         INTEGER NOT NULL DEFAULT 3,
  "gpuTypeIds"       TEXT NOT NULL DEFAULT 'NVIDIA A40,NVIDIA RTX A5000,NVIDIA A100 80GB PCIe',
  "imageName"        TEXT NOT NULL DEFAULT '',
  "maxLotsPerRun"    INTEGER NOT NULL DEFAULT 20000,
  "maxMinutes"       INTEGER NOT NULL DEFAULT 180,
  "maxCostUsdPerRun" DECIMAL(8,2) NOT NULL DEFAULT 5.0,
  "watchdogMinutes"  INTEGER NOT NULL DEFAULT 5,
  "lastRunAt"        TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "embed_job_config_pkey" PRIMARY KEY ("id")
);

INSERT INTO "embed_job_config" ("id", "updatedAt") VALUES ('singleton', CURRENT_TIMESTAMP);
