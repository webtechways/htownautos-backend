-- Calendarios alimentados por la extension: VM en el log de Copart y log de IAAI.
ALTER TABLE "auction_calendar_sync_logs" ADD COLUMN "worker" TEXT;

CREATE TABLE "iaai_calendar_sync_logs" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "worker" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "count" INTEGER,
    "error" TEXT,
    "durationMs" INTEGER,
    "attempts" JSONB NOT NULL DEFAULT '[]',
    CONSTRAINT "iaai_calendar_sync_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "iaai_calendar_sync_logs_startedAt_idx" ON "iaai_calendar_sync_logs"("startedAt");
