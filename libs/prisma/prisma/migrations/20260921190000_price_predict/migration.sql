-- Prediccion masiva de precios para lotes que aun no se han subastado.
--
-- Todo va con IF NOT EXISTS a proposito: esta migracion se aplico a mano para
-- probarla antes de desplegar, asi que el `migrate deploy` del arranque se la
-- encuentra hecha. Sin esto fallaria a medias y Prisma la marcaria como
-- fallida, que es lo que impide arrancar al contenedor entero.

CREATE TABLE IF NOT EXISTS "price_predict_config" (
  "id"                   TEXT NOT NULL DEFAULT 'singleton',
  "selDated"             BOOLEAN NOT NULL DEFAULT true,
  "selUndated"           BOOLEAN NOT NULL DEFAULT false,
  "selSaleDateFrom"      INTEGER,
  "selSaleDateTo"        INTEGER,
  "selStates"            TEXT NOT NULL DEFAULT '',
  "selMakes"             TEXT NOT NULL DEFAULT '',
  "selMinRetail"         INTEGER,
  "selMaxRetail"         INTEGER,
  "skipAlreadyPredicted" BOOLEAN NOT NULL DEFAULT true,
  "redoIfModelChanged"   BOOLEAN NOT NULL DEFAULT true,
  "redoOlderThanDays"    INTEGER NOT NULL DEFAULT 7,
  "photoMode"            TEXT NOT NULL DEFAULT 'embeber',
  "maxLotsToEmbed"       INTEGER NOT NULL DEFAULT 5000,
  "maxLotsPerRun"        INTEGER NOT NULL DEFAULT 20000,
  "batchSize"            INTEGER NOT NULL DEFAULT 500,
  "maxMinutes"           INTEGER NOT NULL DEFAULT 120,
  "maxCostUsdPerRun"     DECIMAL(8,2) NOT NULL DEFAULT 5.0,
  "enabled"              BOOLEAN NOT NULL DEFAULT false,
  "cronHour"             INTEGER NOT NULL DEFAULT 5,
  "everyDays"            INTEGER NOT NULL DEFAULT 1,
  "lastRunAt"            TIMESTAMP(3),
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,

  CONSTRAINT "price_predict_config_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "price_predict_runs" (
  "id"             TEXT NOT NULL,
  "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"     TIMESTAMP(3),
  "status"         TEXT NOT NULL DEFAULT 'pending',
  "trigger"        TEXT NOT NULL DEFAULT 'manual',
  "lotesElegibles" INTEGER NOT NULL DEFAULT 0,
  "lotesPredichos" INTEGER NOT NULL DEFAULT 0,
  "lotesConFotos"  INTEGER NOT NULL DEFAULT 0,
  "lotesEmbebidos" INTEGER NOT NULL DEFAULT 0,
  "modelVersion"   TEXT,
  "costUsd"        DECIMAL(8,4) NOT NULL DEFAULT 0,
  "error"          TEXT,
  "log"            JSONB,

  CONSTRAINT "price_predict_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "price_predict_runs_startedAt_idx" ON "price_predict_runs"("startedAt");

CREATE TABLE IF NOT EXISTS "lot_price_predictions" (
  "lot"           BIGINT NOT NULL,
  "esperado"      INTEGER NOT NULL,
  "p10"           INTEGER NOT NULL,
  "p90"           INTEGER NOT NULL,
  "incertidumbre" DECIMAL(6,3) NOT NULL,
  "conImagenes"   BOOLEAN NOT NULL DEFAULT false,
  "modelVersion"  TEXT NOT NULL,
  "runId"         TEXT,
  "predictedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "lot_price_predictions_pkey" PRIMARY KEY ("lot")
);
-- La pasada pregunta "cuales caducaron" y "cuales son de otra version":
-- las dos consultas que decidan que se vuelve a tasar.
CREATE INDEX IF NOT EXISTS "lot_price_predictions_predictedAt_idx" ON "lot_price_predictions"("predictedAt");
CREATE INDEX IF NOT EXISTS "lot_price_predictions_modelVersion_idx" ON "lot_price_predictions"("modelVersion");

INSERT INTO "price_predict_config" ("id", "updatedAt") VALUES ('singleton', CURRENT_TIMESTAMP)
  ON CONFLICT ("id") DO NOTHING;
