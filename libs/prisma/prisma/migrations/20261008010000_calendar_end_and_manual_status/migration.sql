-- AlterTable
ALTER TABLE "iaai_calendar_entries" ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "endedLanes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "manualStatus" TEXT,
ADD COLUMN     "manualStatusAt" TIMESTAMP(3),
ADD COLUMN     "manualStatusBy" TEXT;

-- AlterTable
ALTER TABLE "auction_calendar_entries" ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "endedLanes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "manualStatus" TEXT,
ADD COLUMN     "manualStatusAt" TIMESTAMP(3),
ADD COLUMN     "manualStatusBy" TEXT;
