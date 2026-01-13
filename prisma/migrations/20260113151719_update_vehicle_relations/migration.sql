/*
  Warnings:

  - You are about to drop the column `make` on the `vehicles` table. All the data in the column will be lost.
  - You are about to drop the column `model` on the `vehicles` table. All the data in the column will be lost.
  - You are about to drop the column `trim` on the `vehicles` table. All the data in the column will be lost.
  - You are about to drop the column `year` on the `vehicles` table. All the data in the column will be lost.
  - Added the required column `makeId` to the `vehicles` table without a default value. This is not possible if the table is not empty.
  - Added the required column `modelId` to the `vehicles` table without a default value. This is not possible if the table is not empty.
  - Added the required column `yearId` to the `vehicles` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "vehicles_year_make_model_idx";

-- AlterTable
ALTER TABLE "vehicles" DROP COLUMN "make",
DROP COLUMN "model",
DROP COLUMN "trim",
DROP COLUMN "year",
ADD COLUMN     "makeId" TEXT NOT NULL,
ADD COLUMN     "modelId" TEXT NOT NULL,
ADD COLUMN     "trimId" TEXT,
ADD COLUMN     "yearId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "vehicles_yearId_makeId_modelId_idx" ON "vehicles"("yearId", "makeId", "modelId");

-- CreateIndex
CREATE INDEX "vehicles_yearId_idx" ON "vehicles"("yearId");

-- CreateIndex
CREATE INDEX "vehicles_makeId_idx" ON "vehicles"("makeId");

-- CreateIndex
CREATE INDEX "vehicles_modelId_idx" ON "vehicles"("modelId");

-- CreateIndex
CREATE INDEX "vehicles_trimId_idx" ON "vehicles"("trimId");

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_yearId_fkey" FOREIGN KEY ("yearId") REFERENCES "vehicle_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_makeId_fkey" FOREIGN KEY ("makeId") REFERENCES "vehicle_makes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "vehicle_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_trimId_fkey" FOREIGN KEY ("trimId") REFERENCES "vehicle_trims"("id") ON DELETE SET NULL ON UPDATE CASCADE;
