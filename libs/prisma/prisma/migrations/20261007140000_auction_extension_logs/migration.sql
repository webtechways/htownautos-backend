-- CreateTable
CREATE TABLE "auction_extension_logs" (
    "id" BIGSERIAL NOT NULL,
    "worker" TEXT NOT NULL,
    "version" TEXT,
    "level" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "at" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auction_extension_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auction_extension_logs_worker_at_idx" ON "auction_extension_logs"("worker", "at");

-- CreateIndex
CREATE INDEX "auction_extension_logs_at_idx" ON "auction_extension_logs"("at");
