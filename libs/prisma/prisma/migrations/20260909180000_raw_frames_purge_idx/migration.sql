-- La purga filtra por (status, receivedAt) a la vez. Habia un indice para cada
-- uno por separado, y Postgres solo puede usar bien uno de los dos: con 1,4M de
-- filas al dia eso convierte cada pasada en un escaneo.
CREATE INDEX IF NOT EXISTS "auction_raw_frames_status_receivedAt_idx"
  ON "auction_raw_frames"("status", "receivedAt");
