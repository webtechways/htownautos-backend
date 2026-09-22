-- Cada cuantas horas se repite el trabajo de vectores.
-- 24 conserva el comportamiento anterior: una vez al dia a `cronHour`.
ALTER TABLE "embed_job_config"
  ADD COLUMN IF NOT EXISTS "cronEveryHours" INTEGER NOT NULL DEFAULT 24;
