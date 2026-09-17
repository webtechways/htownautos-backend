-- Which lots the vector job should pick up.
--
-- The queue was "everything pending, oldest sale date first", which spends GPU
-- on cars that were auctioned months ago while the ones being bid on wait behind
-- 218.066 rows — roughly fifteen nights away at the measured rate.
ALTER TABLE "embed_job_config"
  ADD COLUMN IF NOT EXISTS "selDated"        BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "selFutureSale"   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "selIncludePast"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "selSaleDateFrom" INTEGER,
  ADD COLUMN IF NOT EXISTS "selSaleDateTo"   INTEGER;

-- Escape hatch: one run that ignores the filters entirely.
ALTER TABLE "embed_job_runs"
  ADD COLUMN IF NOT EXISTS "selectionAll" BOOLEAN NOT NULL DEFAULT false;
