-- AlterTable
ALTER TABLE "iaai_scraper_config" ADD COLUMN     "reindexDone" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reindexError" TEXT,
ADD COLUMN     "reindexFinishedAt" TIMESTAMP(3),
ADD COLUMN     "reindexRecreate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reindexRequestedAt" TIMESTAMP(3),
ADD COLUMN     "reindexStartedAt" TIMESTAMP(3),
ADD COLUMN     "reindexStatus" TEXT NOT NULL DEFAULT 'idle',
ADD COLUMN     "reindexTotal" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "iaai_favorites" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stockNumber" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "iaai_favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auction_listing_group_iaai_items" (
    "groupId" UUID NOT NULL,
    "stockNumber" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auction_listing_group_iaai_items_pkey" PRIMARY KEY ("groupId","stockNumber")
);

-- CreateIndex
CREATE INDEX "iaai_favorites_tenantId_userId_idx" ON "iaai_favorites"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "iaai_favorites_tenantId_userId_stockNumber_key" ON "iaai_favorites"("tenantId", "userId", "stockNumber");

-- CreateIndex
CREATE INDEX "auction_listing_group_iaai_items_stockNumber_idx" ON "auction_listing_group_iaai_items"("stockNumber");

-- AddForeignKey
ALTER TABLE "iaai_favorites" ADD CONSTRAINT "iaai_favorites_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iaai_favorites" ADD CONSTRAINT "iaai_favorites_stockNumber_fkey" FOREIGN KEY ("stockNumber") REFERENCES "iaai_listings"("stockNumber") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_listing_group_iaai_items" ADD CONSTRAINT "auction_listing_group_iaai_items_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "auction_listing_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_listing_group_iaai_items" ADD CONSTRAINT "auction_listing_group_iaai_items_stockNumber_fkey" FOREIGN KEY ("stockNumber") REFERENCES "iaai_listings"("stockNumber") ON DELETE CASCADE ON UPDATE CASCADE;

