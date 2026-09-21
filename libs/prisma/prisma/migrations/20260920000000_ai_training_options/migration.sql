-- Opciones de entrenamiento del modelo visor.
--
-- `trainingOnlyWithImages` entrena SOLO con ventas cuyo lote tiene vector de
-- imagen. Hoy son 8.266 de 174.097 ventas con precio, asi que encenderlo sin
-- haber procesado antes el corpus de vendidos da un modelo diminuto: la
-- pantalla ensena las dos cifras justo por eso.
ALTER TABLE "embed_job_config"
  ADD COLUMN IF NOT EXISTS "trainingOnlyWithImages" BOOLEAN NOT NULL DEFAULT false;

-- Que filtro se uso en cada ejecucion. Sin esto, dos entrenamientos con MAE
-- distinto no se pueden comparar: uno pudo mirar 174.000 ventas y el otro 8.000.
ALTER TABLE "model_training_runs"
  ADD COLUMN IF NOT EXISTS "onlyWithImages" BOOLEAN NOT NULL DEFAULT false;
