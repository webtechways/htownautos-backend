-- Tramites (130-U y demas formularios de Texas) generados para un vehiculo.

-- Datos del cliente que exige el 130-U y no estaban en el modelo.
ALTER TABLE "buyers"
  ADD COLUMN IF NOT EXISTS "countyOfResidence"       TEXT,
  ADD COLUMN IF NOT EXISTS "applicantType"           TEXT,
  ADD COLUMN IF NOT EXISTS "militaryStatus"          TEXT,
  ADD COLUMN IF NOT EXISTS "communicationImpediment" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "vehicle_documents" (
  "id"            TEXT NOT NULL,
  "tenantId"      TEXT,
  "vehicleId"     TEXT NOT NULL,
  "buyerId"       TEXT,
  "formKey"       TEXT NOT NULL,
  "formName"      TEXT NOT NULL,
  "templateId"    INTEGER NOT NULL,
  "submissionId"  INTEGER NOT NULL,
  "submitterSlug" TEXT NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'draft',
  "values"        JSONB NOT NULL,
  "mediaId"       TEXT,
  "sentTo"        TEXT,
  "sentAt"        TIMESTAMP(3),
  "completedAt"   TIMESTAMP(3),
  "auditLogUrl"   TEXT,
  "createdById"   TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "vehicle_documents_pkey" PRIMARY KEY ("id")
);

-- La pestana Docs de un vehiculo los pide por fecha.
CREATE INDEX "vehicle_documents_vehicleId_createdAt_idx"
  ON "vehicle_documents"("vehicleId", "createdAt");
CREATE INDEX "vehicle_documents_tenantId_idx" ON "vehicle_documents"("tenantId");
-- Una submission de DocuSeal pertenece a un solo tramite: si se reintenta la
-- generacion, no deben quedar dos filas apuntando al mismo documento.
CREATE UNIQUE INDEX "vehicle_documents_submissionId_key"
  ON "vehicle_documents"("submissionId");

ALTER TABLE "vehicle_documents"
  ADD CONSTRAINT "vehicle_documents_vehicleId_fkey"
  FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vehicle_documents"
  ADD CONSTRAINT "vehicle_documents_buyerId_fkey"
  FOREIGN KEY ("buyerId") REFERENCES "buyers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vehicle_documents"
  ADD CONSTRAINT "vehicle_documents_mediaId_fkey"
  FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
