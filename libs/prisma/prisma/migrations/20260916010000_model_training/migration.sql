-- Reentrenamiento del modelo de precio sobre una ventana movil de dias.

ALTER TABLE "embed_job_config"
  ADD COLUMN "trainingDays"   INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN "autoPromote"    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "lastTrainingAt" TIMESTAMP(3);

-- Se guardan las metricas de los DOS modelos (el que servia y el nuevo) porque
-- la promocion se decide comparandolos: sin las dos cifras no hay auditoria.
CREATE TABLE "model_training_runs" (
  "id"               TEXT NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'pending',
  "trainingDays"     INTEGER NOT NULL DEFAULT 90,
  "rowsTrain"        INTEGER,
  "rowsValid"        INTEGER,
  "rowsWithImages"   INTEGER,
  "maeChampion"      DECIMAL(10,2),
  "maeChallenger"    DECIMAL(10,2),
  "maeBaseline"      DECIMAL(10,2),
  "intervalCoverage" DECIMAL(5,3),
  "promoted"         BOOLEAN NOT NULL DEFAULT false,
  "promotedReason"   TEXT,
  "modelVersion"     TEXT,
  "startedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"       TIMESTAMP(3),
  "error"            TEXT,
  "log"              TEXT,

  CONSTRAINT "model_training_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "model_training_runs_startedAt_idx" ON "model_training_runs"("startedAt");
