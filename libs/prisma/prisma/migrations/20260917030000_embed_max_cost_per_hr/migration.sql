-- Ceiling on the hourly price we are willing to rent at.
--
-- RunPod's create-pod API has no price parameter, so the only control available
-- is to inspect costPerHr right after creation and hand the pod back if it is
-- too expensive. The same A40 has come back at $0.27, $0.49 and once $1.59.
-- The default admits the first two and refuses the third.
ALTER TABLE "embed_job_config"
  ADD COLUMN IF NOT EXISTS "maxCostPerHr" DECIMAL(8,4) NOT NULL DEFAULT 0.60;
