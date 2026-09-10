-- Destinos de chat a los que un tenant reenvia sus notificaciones.
--
-- Hasta ahora las notificaciones solo existian dentro del dashboard: sin la
-- pestaña abierta, nadie se enteraba de un deposito o de un fallo de sync.

CREATE TABLE "notification_channels" (
  "id"                TEXT NOT NULL,
  "tenantId"          TEXT NOT NULL,
  "provider"          TEXT NOT NULL,
  "label"             TEXT NOT NULL,
  "target"            TEXT NOT NULL,
  "credentials"       JSONB,
  -- Vacio = el canal quiere todos los tipos.
  "types"             TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isActive"          BOOLEAN NOT NULL DEFAULT true,
  "linkCode"          TEXT,
  "linkCodeExpiresAt" TIMESTAMP(3),
  "lastSentAt"        TIMESTAMP(3),
  "lastErrorAt"       TIMESTAMP(3),
  "lastErrorMsg"      TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,

  CONSTRAINT "notification_channels_pkey" PRIMARY KEY ("id")
);

-- El codigo de emparejamiento de Telegram se busca por si solo desde el webhook,
-- que llega sin tenant: tiene que ser unico en toda la tabla.
CREATE UNIQUE INDEX "notification_channels_linkCode_key"
  ON "notification_channels"("linkCode");

CREATE INDEX "notification_channels_tenantId_idx"
  ON "notification_channels"("tenantId");

-- El reparto siempre pregunta por los canales activos de un tenant.
CREATE INDEX "notification_channels_tenantId_isActive_idx"
  ON "notification_channels"("tenantId", "isActive");

ALTER TABLE "notification_channels"
  ADD CONSTRAINT "notification_channels_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
