/*
  Warnings:

  - You are about to drop the `meta_values` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "meta_values" DROP CONSTRAINT "meta_values_buyerId_fkey";

-- DropForeignKey
ALTER TABLE "meta_values" DROP CONSTRAINT "meta_values_dealId_fkey";

-- DropForeignKey
ALTER TABLE "meta_values" DROP CONSTRAINT "meta_values_extraExpenseId_fkey";

-- DropForeignKey
ALTER TABLE "meta_values" DROP CONSTRAINT "meta_values_mediaId_fkey";

-- DropForeignKey
ALTER TABLE "meta_values" DROP CONSTRAINT "meta_values_titleId_fkey";

-- DropForeignKey
ALTER TABLE "meta_values" DROP CONSTRAINT "meta_values_userId_fkey";

-- DropForeignKey
ALTER TABLE "meta_values" DROP CONSTRAINT "meta_values_vehicleId_fkey";

-- DropForeignKey
ALTER TABLE "meta_values" DROP CONSTRAINT "meta_values_vehicleMakeId_fkey";

-- DropForeignKey
ALTER TABLE "meta_values" DROP CONSTRAINT "meta_values_vehicleModelId_fkey";

-- DropForeignKey
ALTER TABLE "meta_values" DROP CONSTRAINT "meta_values_vehicleTrimId_fkey";

-- DropForeignKey
ALTER TABLE "meta_values" DROP CONSTRAINT "meta_values_vehicleYearId_fkey";

-- AlterTable
ALTER TABLE "buyers" ADD COLUMN     "metaValue" JSONB;

-- AlterTable
ALTER TABLE "deals" ADD COLUMN     "metaValue" JSONB;

-- AlterTable
ALTER TABLE "extra_expenses" ADD COLUMN     "metaValue" JSONB;

-- AlterTable
ALTER TABLE "media" ADD COLUMN     "metaValue" JSONB;

-- AlterTable
ALTER TABLE "titles" ADD COLUMN     "metaValue" JSONB;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "metaValue" JSONB;

-- AlterTable
ALTER TABLE "vehicle_makes" ADD COLUMN     "metaValue" JSONB;

-- AlterTable
ALTER TABLE "vehicle_models" ADD COLUMN     "metaValue" JSONB;

-- AlterTable
ALTER TABLE "vehicle_trims" ADD COLUMN     "metaValue" JSONB;

-- AlterTable
ALTER TABLE "vehicle_years" ADD COLUMN     "metaValue" JSONB;

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "metaValue" JSONB;

-- DropTable
DROP TABLE "meta_values";
