-- AlterTable
ALTER TABLE "auction_raw_frames" ADD COLUMN     "capturedAt" TIMESTAMP(3),
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'room';
