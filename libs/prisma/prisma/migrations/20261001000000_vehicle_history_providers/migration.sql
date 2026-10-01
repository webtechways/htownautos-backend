-- Vehicle history report router (Carfax / AutoCheck with provider fallback).
-- New tables only; provider rows are created by the service at startup.
-- Rollback: DROP TABLE vehicle_history_calls, vehicle_history_requests, vehicle_history_reports, vehicle_history_settings, vehicle_history_providers;

-- CreateTable
CREATE TABLE "vehicle_history_providers" (
    "key" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "carfaxEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autocheckEnabled" BOOLEAN NOT NULL DEFAULT true,
    "encryptedApiKey" TEXT,
    "baseUrl" TEXT,
    "timeoutMs" INTEGER NOT NULL DEFAULT 90000,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "circuitOpenUntil" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastError" TEXT,
    "healthStatus" TEXT NOT NULL DEFAULT 'unknown',
    "healthCheckedAt" TIMESTAMP(3),
    "healthLatencyMs" INTEGER,
    "healthMessage" TEXT,
    "balance" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_history_providers_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "vehicle_history_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "cacheDays" INTEGER NOT NULL DEFAULT 30,
    "circuitFailureThreshold" INTEGER NOT NULL DEFAULT 3,
    "circuitCooldownMinutes" INTEGER NOT NULL DEFAULT 10,
    "healthCheckMinutes" INTEGER NOT NULL DEFAULT 15,
    "logRetentionDays" INTEGER NOT NULL DEFAULT 90,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_history_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_history_reports" (
    "id" TEXT NOT NULL,
    "vin" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "providerReportId" TEXT,
    "s3Key" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "yearMakeModel" TEXT,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_history_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_history_requests" (
    "id" TEXT NOT NULL,
    "vin" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "source" TEXT,
    "auctionListingId" BIGINT,
    "requestedBy" TEXT,
    "tenantId" TEXT,
    "cacheHit" BOOLEAN NOT NULL DEFAULT false,
    "forced" BOOLEAN NOT NULL DEFAULT false,
    "reportId" TEXT,
    "providerKey" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "attemptLog" JSONB,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "vehicle_history_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_history_calls" (
    "id" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reportType" TEXT,
    "method" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "ok" BOOLEAN NOT NULL,
    "errorCode" TEXT,
    "message" TEXT,
    "durationMs" INTEGER NOT NULL,
    "vin" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_history_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_history_reports_vin_reportType_createdAt_idx" ON "vehicle_history_reports"("vin", "reportType", "createdAt");

-- CreateIndex
CREATE INDEX "vehicle_history_requests_createdAt_idx" ON "vehicle_history_requests"("createdAt");

-- CreateIndex
CREATE INDEX "vehicle_history_requests_vin_reportType_idx" ON "vehicle_history_requests"("vin", "reportType");

-- CreateIndex
CREATE INDEX "vehicle_history_requests_status_idx" ON "vehicle_history_requests"("status");

-- CreateIndex
CREATE INDEX "vehicle_history_calls_providerKey_createdAt_idx" ON "vehicle_history_calls"("providerKey", "createdAt");

-- CreateIndex
CREATE INDEX "vehicle_history_calls_requestId_idx" ON "vehicle_history_calls"("requestId");

-- CreateIndex
CREATE INDEX "vehicle_history_calls_createdAt_idx" ON "vehicle_history_calls"("createdAt");

-- AddForeignKey
ALTER TABLE "vehicle_history_requests" ADD CONSTRAINT "vehicle_history_requests_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "vehicle_history_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_history_calls" ADD CONSTRAINT "vehicle_history_calls_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "vehicle_history_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

