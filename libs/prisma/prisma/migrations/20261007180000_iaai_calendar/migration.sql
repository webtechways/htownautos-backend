-- CreateTable
CREATE TABLE "iaai_calendar_entries" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "branchNumber" INTEGER NOT NULL,
    "branchName" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "startedAt" TIMESTAMP(3) NOT NULL,
    "saleDate" INTEGER NOT NULL,
    "numberOfVehicles" INTEGER NOT NULL DEFAULT 0,
    "auctionSchedule" TEXT,
    "publicAuction" BOOLEAN NOT NULL DEFAULT false,
    "isBranchVirtual" BOOLEAN NOT NULL DEFAULT false,
    "laneCodes" TEXT[],
    "raw" JSONB,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "iaai_calendar_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iaai_calendar_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "refreshHours" INTEGER NOT NULL DEFAULT 6,
    "lanesPerBranch" INTEGER NOT NULL DEFAULT 8,
    "useProxy" BOOLEAN NOT NULL DEFAULT true,
    "lastFetchedAt" TIMESTAMP(3),
    "lastCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastDurationMs" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "iaai_calendar_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "iaai_calendar_entries_auctionId_key" ON "iaai_calendar_entries"("auctionId");

-- CreateIndex
CREATE INDEX "iaai_calendar_entries_startedAt_idx" ON "iaai_calendar_entries"("startedAt");

-- CreateIndex
CREATE INDEX "iaai_calendar_entries_saleDate_idx" ON "iaai_calendar_entries"("saleDate");

-- CreateIndex
CREATE INDEX "iaai_calendar_entries_branchNumber_idx" ON "iaai_calendar_entries"("branchNumber");
