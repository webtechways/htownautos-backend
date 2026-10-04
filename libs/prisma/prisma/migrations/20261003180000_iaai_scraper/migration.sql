-- CreateTable
CREATE TABLE "iaai_listings" (
    "stockNumber" TEXT NOT NULL,
    "externalId" TEXT,
    "providerId" INTEGER,
    "vin" TEXT,
    "year" INTEGER,
    "make" TEXT,
    "model" TEXT,
    "series" TEXT,
    "bodyStyle" TEXT,
    "color" TEXT,
    "engineSize" TEXT,
    "transmission" TEXT,
    "fuelType" TEXT,
    "drivelineType" TEXT,
    "cylinders" TEXT,
    "vehicleType" TEXT,
    "odometer" INTEGER,
    "odometerStatus" TEXT,
    "primaryDamage" TEXT,
    "secondaryDamage" TEXT,
    "lossType" TEXT,
    "saleDocument" TEXT,
    "saleDocumentBrand" TEXT,
    "certState" TEXT,
    "runAndDrive" BOOLEAN,
    "startCode" TEXT,
    "keys" TEXT,
    "acv" INTEGER,
    "repairCost" INTEGER,
    "currentBid" INTEGER,
    "buyNowPrice" INTEGER,
    "reservePrice" INTEGER,
    "branchCode" INTEGER,
    "branchName" TEXT,
    "yardId" TEXT,
    "locationAddress" TEXT,
    "locationCity" TEXT,
    "locationState" TEXT,
    "locationZip" TEXT,
    "seller" TEXT,
    "auctionType" TEXT,
    "auctionAt" TIMESTAMP(3),
    "timezone" TEXT,
    "vehicleStatus" TEXT,
    "whoCanBuy" TEXT,
    "publicAuction" BOOLEAN,
    "imageSourceUrls" JSONB,
    "imageSourceHash" TEXT,
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "images" JSONB,
    "imagesStatus" TEXT NOT NULL DEFAULT 'none',
    "imagesAttempts" INTEGER NOT NULL DEFAULT 0,
    "imagesError" TEXT,
    "imagesClaimedAt" TIMESTAMP(3),
    "imagesUpdatedAt" TIMESTAMP(3),
    "raw" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sourceCreatedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "iaai_listings_pkey" PRIMARY KEY ("stockNumber")
);

-- CreateTable
CREATE TABLE "iaai_scraper_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "paused" BOOLEAN NOT NULL DEFAULT true,
    "scheduleMode" TEXT NOT NULL DEFAULT 'window',
    "windowStart" TEXT NOT NULL DEFAULT '06:00',
    "windowEnd" TEXT NOT NULL DEFAULT '22:00',
    "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "daysOfWeek" INTEGER[] DEFAULT ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[],
    "intervalHours" INTEGER NOT NULL DEFAULT 6,
    "maxRunMinutes" INTEGER NOT NULL DEFAULT 0,
    "pageSize" INTEGER NOT NULL DEFAULT 100,
    "pageDelayMinMs" INTEGER NOT NULL DEFAULT 1500,
    "pageDelayMaxMs" INTEGER NOT NULL DEFAULT 4000,
    "maxPagesPerRun" INTEGER NOT NULL DEFAULT 0,
    "requestTimeoutMs" INTEGER NOT NULL DEFAULT 60000,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "useProxy" BOOLEAN NOT NULL DEFAULT false,
    "inactiveAfterHours" INTEGER NOT NULL DEFAULT 48,
    "downloadImages" BOOLEAN NOT NULL DEFAULT true,
    "imageLotsPerTick" INTEGER NOT NULL DEFAULT 10,
    "imageConcurrency" INTEGER NOT NULL DEFAULT 4,
    "imageMaxPerLot" INTEGER NOT NULL DEFAULT 0,
    "imageMaxAttempts" INTEGER NOT NULL DEFAULT 3,
    "imagesOnlyUpcoming" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "iaai_scraper_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iaai_scrape_runs" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "stopRequested" BOOLEAN NOT NULL DEFAULT false,
    "maxRunMinutes" INTEGER,
    "nextSkip" INTEGER NOT NULL DEFAULT 0,
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "itemsSeen" INTEGER NOT NULL DEFAULT 0,
    "itemsCreated" INTEGER NOT NULL DEFAULT 0,
    "itemsUpdated" INTEGER NOT NULL DEFAULT 0,
    "totalReported" INTEGER,
    "markedInactive" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "message" TEXT,
    "requestedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),

    CONSTRAINT "iaai_scrape_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "iaai_listings_isActive_auctionAt_idx" ON "iaai_listings"("isActive", "auctionAt");

-- CreateIndex
CREATE INDEX "iaai_listings_imagesStatus_auctionAt_idx" ON "iaai_listings"("imagesStatus", "auctionAt");

-- CreateIndex
CREATE INDEX "iaai_listings_lastSeenAt_idx" ON "iaai_listings"("lastSeenAt");

-- CreateIndex
CREATE INDEX "iaai_listings_vin_idx" ON "iaai_listings"("vin");

-- CreateIndex
CREATE INDEX "iaai_listings_make_model_idx" ON "iaai_listings"("make", "model");

-- CreateIndex
CREATE INDEX "iaai_listings_branchCode_idx" ON "iaai_listings"("branchCode");

-- CreateIndex
CREATE INDEX "iaai_scrape_runs_status_idx" ON "iaai_scrape_runs"("status");

-- CreateIndex
CREATE INDEX "iaai_scrape_runs_createdAt_idx" ON "iaai_scrape_runs"("createdAt");

-- AddForeignKey
ALTER TABLE "iaai_listings" ADD CONSTRAINT "iaai_listings_yardId_fkey" FOREIGN KEY ("yardId") REFERENCES "yards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

