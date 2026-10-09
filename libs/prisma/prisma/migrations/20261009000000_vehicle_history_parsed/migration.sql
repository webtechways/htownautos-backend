-- Structured parse of stored Carfax/AutoCheck reports (carfax_reports +
-- vehicle_history_reports, disjoint s3Keys). Task 2 fills in the real
-- parser; this table/queue/consumer exist so it has somewhere to land.

CREATE TABLE IF NOT EXISTS "vehicle_history_parsed" (
    "id"                        TEXT NOT NULL,
    "s3Key"                     TEXT NOT NULL,
    "source"                    TEXT NOT NULL,
    "sourceId"                  TEXT NOT NULL,
    "vin"                       TEXT NOT NULL,
    "reportType"                TEXT NOT NULL,
    "providerKey"               TEXT,
    "template"                  TEXT NOT NULL,
    "parserVersion"             INTEGER NOT NULL,
    "status"                    TEXT NOT NULL,
    "confidence"                DECIMAL(3,2) NOT NULL,
    "llmUsed"                   BOOLEAN NOT NULL DEFAULT false,
    "llmSections"               TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "reportDate"                TIMESTAMP(3),
    "accidentCount"             INTEGER,
    "damageReportCount"         INTEGER,
    "structuralDamage"          BOOLEAN,
    "airbagDeployed"            BOOLEAN,
    "titleBrands"               TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "brandedTitle"              BOOLEAN,
    "totalLoss"                 BOOLEAN,
    "salvage"                   BOOLEAN,
    "flood"                     BOOLEAN,
    "lemon"                     BOOLEAN,
    "ownerCount"                INTEGER,
    "lastOdometer"              INTEGER,
    "lastOdometerDate"          TIMESTAMP(3),
    "odometerRollbackSuspected" BOOLEAN,
    "usageTypes"                TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "serviceRecordCount"        INTEGER,
    "openRecallCount"           INTEGER,
    "lastReportedState"         TEXT,
    "raw"                       JSONB NOT NULL,
    "error"                     TEXT,
    "parsedAt"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vehicle_history_parsed_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_history_parsed_s3Key_key" ON "vehicle_history_parsed"("s3Key");
CREATE INDEX IF NOT EXISTS "vehicle_history_parsed_vin_idx" ON "vehicle_history_parsed"("vin");
CREATE INDEX IF NOT EXISTS "vehicle_history_parsed_parserVersion_idx" ON "vehicle_history_parsed"("parserVersion");

CREATE TABLE IF NOT EXISTS "vh_odometer_readings" (
    "id"       TEXT NOT NULL,
    "parsedId" TEXT NOT NULL,
    "vin"      TEXT NOT NULL,
    "date"     TIMESTAMP(3),
    "miles"    INTEGER NOT NULL,
    "source"   TEXT,
    CONSTRAINT "vh_odometer_readings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "vh_odometer_readings_vin_idx" ON "vh_odometer_readings"("vin");
CREATE INDEX IF NOT EXISTS "vh_odometer_readings_parsedId_idx" ON "vh_odometer_readings"("parsedId");

DO $$ BEGIN
    ALTER TABLE "vh_odometer_readings" ADD CONSTRAINT "vh_odometer_readings_parsedId_fkey"
        FOREIGN KEY ("parsedId") REFERENCES "vehicle_history_parsed"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "vh_damage_events" (
    "id"          TEXT NOT NULL,
    "parsedId"    TEXT NOT NULL,
    "vin"         TEXT NOT NULL,
    "date"        TIMESTAMP(3),
    "kind"        TEXT NOT NULL,
    "severity"    TEXT,
    "area"        TEXT,
    "airbag"      BOOLEAN,
    "description" TEXT,
    CONSTRAINT "vh_damage_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "vh_damage_events_vin_idx" ON "vh_damage_events"("vin");
CREATE INDEX IF NOT EXISTS "vh_damage_events_parsedId_idx" ON "vh_damage_events"("parsedId");

DO $$ BEGIN
    ALTER TABLE "vh_damage_events" ADD CONSTRAINT "vh_damage_events_parsedId_fkey"
        FOREIGN KEY ("parsedId") REFERENCES "vehicle_history_parsed"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "vh_title_events" (
    "id"       TEXT NOT NULL,
    "parsedId" TEXT NOT NULL,
    "vin"      TEXT NOT NULL,
    "date"     TIMESTAMP(3),
    "state"    TEXT,
    "brand"    TEXT,
    "kind"     TEXT,
    "odometer" INTEGER,
    CONSTRAINT "vh_title_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "vh_title_events_vin_idx" ON "vh_title_events"("vin");
CREATE INDEX IF NOT EXISTS "vh_title_events_parsedId_idx" ON "vh_title_events"("parsedId");

DO $$ BEGIN
    ALTER TABLE "vh_title_events" ADD CONSTRAINT "vh_title_events_parsedId_fkey"
        FOREIGN KEY ("parsedId") REFERENCES "vehicle_history_parsed"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "vh_ownership_periods" (
    "id"           TEXT NOT NULL,
    "parsedId"     TEXT NOT NULL,
    "vin"          TEXT NOT NULL,
    "ownerIndex"   INTEGER NOT NULL,
    "start"        TIMESTAMP(3),
    "end"          TIMESTAMP(3),
    "usageType"    TEXT,
    "state"        TEXT,
    "milesPerYear" INTEGER,
    CONSTRAINT "vh_ownership_periods_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "vh_ownership_periods_vin_idx" ON "vh_ownership_periods"("vin");
CREATE INDEX IF NOT EXISTS "vh_ownership_periods_parsedId_idx" ON "vh_ownership_periods"("parsedId");

DO $$ BEGIN
    ALTER TABLE "vh_ownership_periods" ADD CONSTRAINT "vh_ownership_periods_parsedId_fkey"
        FOREIGN KEY ("parsedId") REFERENCES "vehicle_history_parsed"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
