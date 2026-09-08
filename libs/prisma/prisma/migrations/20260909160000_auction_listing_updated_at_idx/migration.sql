-- El dashboard pide MAX(updatedAt) en cada arranque y no habia indice: eran
-- 300k filas escaneadas con sus columnas JSON detras, 35 segundos.
--
-- Sin CONCURRENTLY a proposito: Prisma envuelve cada migracion en una
-- transaccion y CREATE INDEX CONCURRENTLY no puede correr dentro de una — la
-- migracion fallaria y tumbaria el despliegue. Sobre 300k filas el bloqueo de
-- escritura dura un par de segundos.
CREATE INDEX IF NOT EXISTS "auction_listings_updatedAt_idx"
  ON "auction_listings"("updatedAt");
