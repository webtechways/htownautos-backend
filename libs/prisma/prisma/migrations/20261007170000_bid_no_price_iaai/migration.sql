-- CreateTable
CREATE TABLE "bid_no_price_iaai" (
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

    CONSTRAINT "bid_no_price_iaai_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bid_no_price_iaai_lot_idx" ON "bid_no_price_iaai"("lot");

-- CreateIndex
CREATE INDEX "bid_no_price_iaai_saleRoom_firstSeenAt_idx" ON "bid_no_price_iaai"("saleRoom", "firstSeenAt");

-- CreateIndex
CREATE INDEX "bid_no_price_iaai_firstSeenAt_idx" ON "bid_no_price_iaai"("firstSeenAt");
