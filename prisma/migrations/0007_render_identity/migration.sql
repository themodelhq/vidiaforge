-- V6: Add renderIdentity column + partial unique index for race-safe deduplication.
--
-- PROBLEM (v6 §11/12): The render deduplication used findFirst() + create()
-- in application code. Two concurrent requests could both find no existing
-- job and both create one, producing duplicate expensive renders.
--
-- FIX (v6 §13/14): Add a `renderIdentity` column = SHA256(projectId +
-- timelineHash + format + resolution + fps + bitrate). Create a PARTIAL
-- UNIQUE INDEX that only covers active/completed jobs (not failed/cancelled).
-- This lets the database enforce uniqueness: the second INSERT fails with
-- a unique constraint violation, which the API catches and returns the
-- existing job.
--
-- Failed/cancelled jobs are excluded from the index so retries can create
-- a new job with the same renderIdentity.

-- ─── Step 1: Add renderIdentity column ─────────────────────────────────────
ALTER TABLE "RenderJob" ADD COLUMN IF NOT EXISTS "renderIdentity" TEXT;

-- ─── Step 2: Add index for lookups ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "RenderJob_renderIdentity_idx" ON "RenderJob"("renderIdentity");

-- ─── Step 3: Add partial unique index for active/completed jobs ─────────────
-- This prevents concurrent requests from creating duplicate active renders.
-- Only applies when renderIdentity IS NOT NULL and status is active/completed.
-- Failed/cancelled jobs are NOT included so retries work.
CREATE UNIQUE INDEX IF NOT EXISTS "RenderJob_renderIdentity_active_unique"
    ON "RenderJob"("renderIdentity")
    WHERE "renderIdentity" IS NOT NULL
    AND "status" IN ('queued', 'processing', 'completed');
