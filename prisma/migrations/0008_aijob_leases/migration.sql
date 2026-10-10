-- V11.1: Add durable AIJob lease/ownership fields.
--
-- Adds: workerId, attemptId, heartbeatAt, processingStartedAt, attempt
-- These fields persist the worker/attempt ownership to PostgreSQL so that:
--   - crash recovery can detect stale jobs (heartbeatAt < now - lease)
--   - stale workers cannot finalize jobs owned by new attempts
--   - the system can answer "which worker owns this job?" from durable state
--
-- Migration is ADDITIVE — no columns are removed, no data is deleted.
-- Existing processing jobs are preserved; the recovery system will evaluate
-- them as stale (NULL heartbeatAt → stale after lease expires) on next
-- worker startup.

ALTER TABLE "AIJob" ADD COLUMN IF NOT EXISTS "workerId" TEXT;
ALTER TABLE "AIJob" ADD COLUMN IF NOT EXISTS "attemptId" TEXT;
ALTER TABLE "AIJob" ADD COLUMN IF NOT EXISTS "heartbeatAt" TIMESTAMP(3);
ALTER TABLE "AIJob" ADD COLUMN IF NOT EXISTS "processingStartedAt" TIMESTAMP(3);
ALTER TABLE "AIJob" ADD COLUMN IF NOT EXISTS "attempt" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "AIJob_status_idx" ON "AIJob"("status");
CREATE INDEX IF NOT EXISTS "AIJob_heartbeatAt_idx" ON "AIJob"("heartbeatAt");
CREATE INDEX IF NOT EXISTS "AIJob_workerId_idx" ON "AIJob"("workerId");
