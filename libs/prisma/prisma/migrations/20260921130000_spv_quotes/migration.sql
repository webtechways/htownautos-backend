-- Consultas de SPV ya resueltas.
--
-- TxDMV no tiene API: el valor sale de su calculadora publica. Guardar cada
-- respuesta una semana —que es cada cuanto recalculan— evita convertir un
-- servicio del estado en nuestro backend.
CREATE TABLE "spv_quotes" (
  "id"        TEXT NOT NULL,
  "state"     TEXT NOT NULL,
  "vin"       TEXT NOT NULL,
  "odometer"  INTEGER NOT NULL,
  "year"      INTEGER,
  "make"      TEXT,
  "model"     TEXT,
  "value"     INTEGER NOT NULL,
  "source"    TEXT NOT NULL DEFAULT 'txdmv',
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "spv_quotes_pkey" PRIMARY KEY ("id")
);

-- El odometro entra en la clave porque el valor depende de el.
CREATE UNIQUE INDEX "spv_quotes_state_vin_odometer_key"
  ON "spv_quotes"("state", "vin", "odometer");
CREATE INDEX "spv_quotes_fetchedAt_idx" ON "spv_quotes"("fetchedAt");
