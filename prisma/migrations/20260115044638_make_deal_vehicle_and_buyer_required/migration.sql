/*
  Warnings:

  - Made the column `vehicleId` on table `deals` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "deals" DROP CONSTRAINT "deals_vehicleId_fkey";

-- AlterTable
ALTER TABLE "deals" ALTER COLUMN "vehicleId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
