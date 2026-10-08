-- Reintentos configurables de la sync del calendario + log de cada sync.
ALTER TABLE "auction_calendar_config"
  ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN "retryDelaySeconds" INTEGER NOT NULL DEFAULT 30;

CREATE TABLE "auction_calendar_sync_logs" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "count" INTEGER,
    "error" TEXT,
    "durationMs" INTEGER,
    "attempts" JSONB NOT NULL DEFAULT '[]',
    CONSTRAINT "auction_calendar_sync_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "auction_calendar_sync_logs_startedAt_idx" ON "auction_calendar_sync_logs"("startedAt");
