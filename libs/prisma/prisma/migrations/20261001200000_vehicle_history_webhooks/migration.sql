-- Order callbacks for API callers: callbackUrl on requests + signed webhook deliveries.
-- Rollback: DROP TABLE vehicle_history_webhooks; ALTER TABLE vehicle_history_requests DROP COLUMN "callbackUrl";

-- AlterTable
ALTER TABLE "vehicle_history_requests" ADD COLUMN     "callbackUrl" TEXT;

-- CreateTable
CREATE TABLE "vehicle_history_webhooks" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastStatus" INTEGER,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "vehicle_history_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_history_webhooks_status_nextAttemptAt_idx" ON "vehicle_history_webhooks"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "vehicle_history_webhooks_requestId_idx" ON "vehicle_history_webhooks"("requestId");

-- AddForeignKey
ALTER TABLE "vehicle_history_webhooks" ADD CONSTRAINT "vehicle_history_webhooks_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "vehicle_history_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

