-- S2 migration: add outputAssetId column to RenderJob.
--
-- When a render job completes, the worker creates a new MediaAsset row for the
-- rendered output (kind='video', storagePath = renders/{renderJobId}/output.{ext})
-- and stores the row's id in this column. The UI can then list + download
-- rendered outputs like any other media asset.
--
-- Nullable so queued / processing / failed / cancelled jobs don't require an
-- output row. No FK constraint: if the output MediaAsset is deleted (e.g. via
-- a project cleanup script), we want the RenderJob row to remain queryable so
-- the UI can still show "Failed" or "Cancelled" status without 500ing.
--
-- Added two supporting indexes alongside the column:
--   - `RenderJob_status_idx` enables fast filtering of jobs by lifecycle state
--     (the dashboard lists "in-progress" + "recently completed" jobs separately).
--   - `RenderJob_outputAssetId_idx` enables the inverse query: "find the
--     RenderJob that produced this MediaAsset" (used by analytics + audit logs).

ALTER TABLE "RenderJob" ADD COLUMN "outputAssetId" TEXT;

CREATE INDEX "RenderJob_status_idx" ON "RenderJob"("status");

CREATE INDEX "RenderJob_outputAssetId_idx" ON "RenderJob"("outputAssetId");
