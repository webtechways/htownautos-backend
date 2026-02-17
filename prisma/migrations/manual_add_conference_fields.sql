-- Add conference fields to phone_calls table
ALTER TABLE "phone_calls" ADD COLUMN IF NOT EXISTS "conferenceSid" TEXT;
ALTER TABLE "phone_calls" ADD COLUMN IF NOT EXISTS "conferenceName" TEXT;
ALTER TABLE "phone_calls" ADD COLUMN IF NOT EXISTS "segmentNumber" INTEGER NOT NULL DEFAULT 0;

-- Create indexes
CREATE INDEX IF NOT EXISTS "phone_calls_conferenceSid_idx" ON "phone_calls"("conferenceSid");
CREATE INDEX IF NOT EXISTS "phone_calls_conferenceName_idx" ON "phone_calls"("conferenceName");
