-- Paid provider jobs that outlived their time budget, re-polled in the background.
-- Rollback: DROP TABLE vehicle_history_pending_jobs;

-- CreateTable
CREATE TABLE "vehicle_history_pending_jobs" (
    "id" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "vin" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "requestId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "checks" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "reportId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "vehicle_history_pending_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_history_pending_jobs_status_createdAt_idx" ON "vehicle_history_pending_jobs"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_history_pending_jobs_providerKey_token_key" ON "vehicle_history_pending_jobs"("providerKey", "token");

