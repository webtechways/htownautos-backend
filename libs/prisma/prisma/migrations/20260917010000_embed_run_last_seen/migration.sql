-- Last time the POD reported in (log line or vector batch).
--
-- Without it, the boot-time sweep cannot tell a pod orphaned by a crash from a
-- pod that is working fine while the backend redeploys underneath it — so it
-- killed both. On 2026-09-16 that destroyed a run 3 h 57 min in, 16.000 of
-- 200.000 lots done, five seconds after its last progress line.
ALTER TABLE "embed_job_runs" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3);

-- Runs already in flight get seeded from their start so the new sweep has
-- something to compare against instead of treating them as never-seen.
UPDATE "embed_job_runs" SET "lastSeenAt" = "startedAt" WHERE "lastSeenAt" IS NULL;
