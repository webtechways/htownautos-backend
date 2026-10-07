-- CreateTable
CREATE TABLE "bid_no_price" (
    "id" TEXT NOT NULL,
    "room" TEXT NOT NULL,
    "saleRoom" TEXT,
    "lot" BIGINT NOT NULL,
    "order" INTEGER NOT NULL,
    "saleDay" TEXT NOT NULL,
    "country" TEXT,
    "sold" BOOLEAN NOT NULL DEFAULT false,
    "round" INTEGER,
    "ticks" INTEGER,
    "reserve" BOOLEAN,
    "seenCount" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "raw" JSONB,

    CONSTRAINT "bid_no_price_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bid_no_price_lot_idx" ON "bid_no_price"("lot");

-- CreateIndex
CREATE INDEX "bid_no_price_saleRoom_firstSeenAt_idx" ON "bid_no_price"("saleRoom", "firstSeenAt");

-- CreateIndex
CREATE INDEX "bid_no_price_firstSeenAt_idx" ON "bid_no_price"("firstSeenAt");
