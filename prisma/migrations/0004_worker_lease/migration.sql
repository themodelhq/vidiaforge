-- V4-S2 migration: worker lease + heartbeat columns on RenderJob + MediaAsset.
--
-- Closes two P0 holes in the worker/render pipeline:
--
-- 1. P0-16/P0-19 (stale-job recovery is WRONG): the previous recovery sweep
--    marked ALL `queued` + `processing` RenderJobs as failed at worker startup,
--    which killed legitimate queued jobs waiting for a worker to pick them up.
--    Fix: the recovery sweep now ONLY marks jobs as failed if their
--    `heartbeatAt` is older than RENDER_JOB_STALE_AFTER_MS (default 30min).
--    Jobs with a recent heartbeat (or queued jobs with NO heartbeat at all)
--    are NOT recovered. This requires the new `heartbeatAt` column.
--
-- 2. P0-17/P0-18 (no worker lease/heartbeat): there was no way to distinguish
--    a crashed worker from an active one. Fix: workers now claim a job by
--    writing their `workerId` (UUID generated at worker startup), an
--    `attemptId` (UUID per attempt), and updating `heartbeatAt` every ~20s
--    while FFmpeg runs. Before any DB update the worker verifies `attemptId`
--    still matches — a stale worker (mid-crash) cannot clobber a newer retry.
--    The `attempt` counter is incremented on each retry so dashboards can
--    surface "attempt 2/3" hints.
--
-- The same pattern is applied to MediaAsset (processingStartedAt,
-- processingWorkerId, processingHeartbeatAt) so the media-ingestion worker
-- gets the same crash-recovery semantics — a long ingestion that's still
-- actively heartbeating is NOT marked failed.
--
-- All five columns are NULLABLE because:
--   - `queued` RenderJobs have no worker assigned yet (workerId NULL).
--   - `uploading` MediaAssets haven't been claimed by the ingestion worker.
--   - Jobs created before this migration backfill to NULL → treated as
--     "no heartbeat yet" by the recovery sweep (NOT marked failed).

ALTER TABLE "RenderJob"
    ADD COLUMN "workerId"     TEXT,
    ADD COLUMN "attemptId"    TEXT,
    ADD COLUMN "heartbeatAt"  TIMESTAMP(3),
    ADD COLUMN "attempt"      INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "RenderJob_workerId_idx"    ON "RenderJob"("workerId");
CREATE INDEX "RenderJob_heartbeatAt_idx" ON "RenderJob"("heartbeatAt");

ALTER TABLE "MediaAsset"
    ADD COLUMN "processingStartedAt"   TIMESTAMP(3),
    ADD COLUMN "processingWorkerId"    TEXT,
    ADD COLUMN "processingHeartbeatAt" TIMESTAMP(3);

CREATE INDEX "MediaAsset_processingHeartbeatAt_idx" ON "MediaAsset"("processingHeartbeatAt");
