-- CreateTable
CREATE TABLE "auction_bid_increments" (
    "id" TEXT NOT NULL,
    "auction" TEXT NOT NULL DEFAULT 'copart',
    "fromPrice" DECIMAL(12,2) NOT NULL,
    "increment" DECIMAL(12,2) NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auction_bid_increments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auction_bid_increments_auction_fromPrice_key" ON "auction_bid_increments"("auction", "fromPrice");

-- Seed: Jumping Table de Copart deducida de 330k pujas reales (2026-10-07)
INSERT INTO "auction_bid_increments" ("id", "auction", "fromPrice", "increment", "updatedAt") VALUES
  (gen_random_uuid()::text, 'copart', 0, 1, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'copart', 5, 5, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'copart', 40, 10, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'copart', 100, 25, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'copart', 1000, 50, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'copart', 5000, 100, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'copart', 25000, 250, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'copart', 50000, 500, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'copart', 100000, 1000, CURRENT_TIMESTAMP);
