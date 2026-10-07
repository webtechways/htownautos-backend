-- CreateTable
CREATE TABLE "iaai_sale_results" (
    "id" TEXT NOT NULL,
    "lot" BIGINT NOT NULL,
    "saleDate" INTEGER,
    "auctionSession" TEXT,
    "saleLocationSlug" TEXT,
    "finalBid" DECIMAL(12,2),
    "askingPrice" DECIMAL(12,2),
    "reserve" BOOLEAN,
    "sold" BOOLEAN,
    "ticks" INTEGER,
    "round" INTEGER,
    "saleOrder" INTEGER,
    "event" TEXT,
    "pageUrl" TEXT,
    "receivedAt" TIMESTAMP(3),
    "saleRoom" TEXT,
    "reserveMet" BOOLEAN,
    "approved" BOOLEAN,
    "buyerNo" TEXT,
    "buyerState" TEXT,
    "buyerCountry" TEXT,
    "itemNo" INTEGER,
    "emittedAt" TIMESTAMP(3),
    "pendingApproval" BOOLEAN,
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "vin" TEXT,
    "year" INTEGER,
    "make" TEXT,
    "model" TEXT,
    "modelDetail" TEXT,
    "trim" TEXT,
    "bodyStyle" TEXT,
    "color" TEXT,
    "damageDescription" TEXT,
    "secondaryDamage" TEXT,
    "saleTitleType" TEXT,
    "saleTitleState" TEXT,
    "odometer" DECIMAL(12,1),
    "runsDrives" TEXT,
    "engine" TEXT,
    "transmission" TEXT,
    "drive" TEXT,
    "fuelType" TEXT,
    "cylinders" TEXT,
    "estRetailValue" DECIMAL(12,2),
    "repairCost" DECIMAL(12,2),
    "highBidAtSync" DECIMAL(12,2),
    "yardNumber" INTEGER,
    "yardName" TEXT,
    "locationCity" TEXT,
    "locationState" TEXT,
    "locationZip" TEXT,
    "sellerName" TEXT,
    "sellerCategory" TEXT,
    "vehicleSnapshot" JSONB,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "iaai_sale_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iaai_bid_events" (
    "id" TEXT NOT NULL,
    "room" TEXT NOT NULL,
    "saleRoom" TEXT,
    "lot" BIGINT NOT NULL,
    "order" INTEGER NOT NULL,
    "saleDay" TEXT NOT NULL,
    "bid" DECIMAL(12,2),
    "asking" DECIMAL(12,2),
    "increment" DECIMAL(12,2),
    "country" TEXT,
    "sold" BOOLEAN NOT NULL DEFAULT false,
    "round" INTEGER,
    "ticks" INTEGER,
    "reserve" BOOLEAN,
    "seenCount" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "raw" JSONB,

    CONSTRAINT "iaai_bid_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "iaai_sale_results_lot_idx" ON "iaai_sale_results"("lot");

-- CreateIndex
CREATE INDEX "iaai_sale_results_saleDate_idx" ON "iaai_sale_results"("saleDate");

-- CreateIndex
CREATE INDEX "iaai_sale_results_saleRoom_idx" ON "iaai_sale_results"("saleRoom");

-- CreateIndex
CREATE INDEX "iaai_sale_results_sold_idx" ON "iaai_sale_results"("sold");

-- CreateIndex
CREATE INDEX "iaai_sale_results_make_idx" ON "iaai_sale_results"("make");

-- CreateIndex
CREATE INDEX "iaai_sale_results_year_idx" ON "iaai_sale_results"("year");

-- CreateIndex
CREATE INDEX "iaai_sale_results_yardNumber_idx" ON "iaai_sale_results"("yardNumber");

-- CreateIndex
CREATE INDEX "iaai_sale_results_saleTitleType_idx" ON "iaai_sale_results"("saleTitleType");

-- CreateIndex
CREATE INDEX "iaai_sale_results_sellerCategory_idx" ON "iaai_sale_results"("sellerCategory");

-- CreateIndex
CREATE UNIQUE INDEX "iaai_sale_results_lot_saleDate_key" ON "iaai_sale_results"("lot", "saleDate");

-- CreateIndex
CREATE INDEX "iaai_bid_events_lot_idx" ON "iaai_bid_events"("lot");

-- CreateIndex
CREATE INDEX "iaai_bid_events_saleRoom_firstSeenAt_idx" ON "iaai_bid_events"("saleRoom", "firstSeenAt");

-- CreateIndex
CREATE INDEX "iaai_bid_events_firstSeenAt_idx" ON "iaai_bid_events"("firstSeenAt");
