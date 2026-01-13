-- CreateTable
CREATE TABLE "meta_values" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "userId" TEXT,
    "buyerId" TEXT,
    "dealId" TEXT,
    "titleId" TEXT,
    "mediaId" TEXT,
    "vehicleId" TEXT,
    "extraExpenseId" TEXT,
    "vehicleYearId" TEXT,
    "vehicleMakeId" TEXT,
    "vehicleModelId" TEXT,
    "vehicleTrimId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meta_values_userId_idx" ON "meta_values"("userId");

-- CreateIndex
CREATE INDEX "meta_values_buyerId_idx" ON "meta_values"("buyerId");

-- CreateIndex
CREATE INDEX "meta_values_dealId_idx" ON "meta_values"("dealId");

-- CreateIndex
CREATE INDEX "meta_values_titleId_idx" ON "meta_values"("titleId");

-- CreateIndex
CREATE INDEX "meta_values_mediaId_idx" ON "meta_values"("mediaId");

-- CreateIndex
CREATE INDEX "meta_values_vehicleId_idx" ON "meta_values"("vehicleId");

-- CreateIndex
CREATE INDEX "meta_values_extraExpenseId_idx" ON "meta_values"("extraExpenseId");

-- CreateIndex
CREATE INDEX "meta_values_vehicleYearId_idx" ON "meta_values"("vehicleYearId");

-- CreateIndex
CREATE INDEX "meta_values_vehicleMakeId_idx" ON "meta_values"("vehicleMakeId");

-- CreateIndex
CREATE INDEX "meta_values_vehicleModelId_idx" ON "meta_values"("vehicleModelId");

-- CreateIndex
CREATE INDEX "meta_values_vehicleTrimId_idx" ON "meta_values"("vehicleTrimId");

-- CreateIndex
CREATE INDEX "meta_values_key_idx" ON "meta_values"("key");

-- AddForeignKey
ALTER TABLE "meta_values" ADD CONSTRAINT "meta_values_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_values" ADD CONSTRAINT "meta_values_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "buyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_values" ADD CONSTRAINT "meta_values_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_values" ADD CONSTRAINT "meta_values_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_values" ADD CONSTRAINT "meta_values_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_values" ADD CONSTRAINT "meta_values_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_values" ADD CONSTRAINT "meta_values_extraExpenseId_fkey" FOREIGN KEY ("extraExpenseId") REFERENCES "extra_expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_values" ADD CONSTRAINT "meta_values_vehicleYearId_fkey" FOREIGN KEY ("vehicleYearId") REFERENCES "vehicle_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_values" ADD CONSTRAINT "meta_values_vehicleMakeId_fkey" FOREIGN KEY ("vehicleMakeId") REFERENCES "vehicle_makes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_values" ADD CONSTRAINT "meta_values_vehicleModelId_fkey" FOREIGN KEY ("vehicleModelId") REFERENCES "vehicle_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_values" ADD CONSTRAINT "meta_values_vehicleTrimId_fkey" FOREIGN KEY ("vehicleTrimId") REFERENCES "vehicle_trims"("id") ON DELETE CASCADE ON UPDATE CASCADE;
