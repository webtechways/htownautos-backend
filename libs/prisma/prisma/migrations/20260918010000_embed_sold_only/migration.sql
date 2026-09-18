-- Restringir la cola a lotes con precio de martillo.
--
-- Sin esto, "incluir ya subastados" mete los 218.066 lotes pasados con fotos,
-- de los que solo 95.572 tienen venta registrada. Los otros 122.494 no pueden
-- entrenar nada: les falta la etiqueta.
ALTER TABLE "embed_job_config"
  ADD COLUMN IF NOT EXISTS "selSoldOnly" BOOLEAN NOT NULL DEFAULT false;
