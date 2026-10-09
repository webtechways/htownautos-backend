-- OpenAI structured-output extraction of stored Carfax/AutoCheck reports.
-- Additive only: the deterministic parser (`vehicle_history_parsed` and its
-- child tables) is untouched and remains the source of the frozen v1
-- `GET /vehicle-history/parsed/:vin` shape.

CREATE TABLE IF NOT EXISTS "vehicle_history_extractions" (
    "id"                    TEXT NOT NULL,
    "s3Key"                 TEXT NOT NULL,
    "sourceTable"           TEXT NOT NULL,
    "sourceId"              TEXT NOT NULL,
    "vin"                   TEXT NOT NULL,
    "status"                TEXT NOT NULL,
    "model"                 TEXT NOT NULL,
    "promptVersion"         INTEGER NOT NULL,
    "data"                  JSONB,
    "mileage"               INTEGER,
    "accident"              BOOLEAN,
    "title"                 TEXT,
    "value"                 INTEGER,
    "serviceHistoryRecords" INTEGER,
    "openRecalls"           INTEGER,
    "lastOwnerState"        TEXT,
    "ownerCount"            INTEGER,
    "anyFlood"              BOOLEAN NOT NULL DEFAULT false,
    "anyBurn"               BOOLEAN NOT NULL DEFAULT false,
    "anyVandalism"          BOOLEAN NOT NULL DEFAULT false,
    "anyTheft"              BOOLEAN NOT NULL DEFAULT false,
    "anyTotalLoss"          BOOLEAN NOT NULL DEFAULT false,
    "anySalvageIssue"       BOOLEAN NOT NULL DEFAULT false,
    "costUsdTotal"          DECIMAL(10,6) NOT NULL DEFAULT 0,
    "error"                 TEXT,
    "extractedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vehicle_history_extractions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_history_extractions_s3Key_key" ON "vehicle_history_extractions"("s3Key");
CREATE INDEX IF NOT EXISTS "vehicle_history_extractions_vin_idx" ON "vehicle_history_extractions"("vin");
CREATE INDEX IF NOT EXISTS "vehicle_history_extractions_title_idx" ON "vehicle_history_extractions"("title");

CREATE TABLE IF NOT EXISTS "vehicle_history_extraction_logs" (
    "id"                TEXT NOT NULL,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "s3Key"             TEXT NOT NULL,
    "vin"               TEXT NOT NULL,
    "sourceTable"       TEXT NOT NULL,
    "sourceId"          TEXT NOT NULL,
    "trigger"           TEXT NOT NULL,
    "triggeredByUserId" TEXT,
    "model"             TEXT NOT NULL,
    "promptVersion"     INTEGER NOT NULL,
    "inputMode"         TEXT NOT NULL,
    "inputChars"        INTEGER,
    "promptTokens"      INTEGER,
    "cachedTokens"      INTEGER,
    "completionTokens"  INTEGER,
    "costUsd"           DECIMAL(10,6),
    "latencyMs"         INTEGER,
    "attempt"           INTEGER NOT NULL,
    "status"            TEXT NOT NULL,
    "error"             TEXT,
    "openaiRequestId"   TEXT,
    "truncated"         BOOLEAN NOT NULL DEFAULT false,
    "rawUsage"          JSONB,
    "extractionId"      TEXT,
    CONSTRAINT "vehicle_history_extraction_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "vehicle_history_extraction_logs_createdAt_idx" ON "vehicle_history_extraction_logs"("createdAt");
CREATE INDEX IF NOT EXISTS "vehicle_history_extraction_logs_s3Key_createdAt_idx" ON "vehicle_history_extraction_logs"("s3Key", "createdAt");

DO $$ BEGIN
    ALTER TABLE "vehicle_history_extraction_logs" ADD CONSTRAINT "vehicle_history_extraction_logs_extractionId_fkey"
        FOREIGN KEY ("extractionId") REFERENCES "vehicle_history_extractions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
