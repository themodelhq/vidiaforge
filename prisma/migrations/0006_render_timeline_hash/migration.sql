-- V4-S2 migration: render deduplication via timelineHash (P0-27/P0-28).
--
-- Schema bug: previously the deduplication check in POST /api/render used
-- ONLY (projectId, format, resolution, fps, bitrate) — it didn't include
-- the timeline CONTENT. So a user who edited their timeline and re-submitted
-- a render was incorrectly told "an identical render is already in progress"
-- (the dedup short-circuit returned the OLD job for the OLD timeline). The
-- new render request would never fire, and the user would wait forever for
-- a render of the OLD timeline that nobody wanted.
--
-- Fix: add a `timelineHash` column (nullable, indexed) that stores the
-- SHA-256 of the render-relevant timeline content (tracks, clips with their
-- transforms/effects/filters/transitions/keyframes/masks/text/captions/audio,
-- markers, in/out points) — excluding irrelevant UI state (selectedClipIds,
-- scrollX, zoom, etc.). See src/lib/render/timeline-hash.ts.
--
-- The dedup check now keys on (projectId, timelineHash, format, resolution,
-- fps, bitrate) so a timeline edit produces a NEW hash → a NEW render job.
-- A re-submit of the same timeline still hits the dedup short-circuit and
-- returns the existing active job — that's the correct behavior.
--
-- Bonus: a COMPLETED job with the same timelineHash + render options can be
-- reused as a cached render (return the existing output MediaAsset instead
-- of re-encoding) — closes the "burned compute on duplicate renders" hole.
--
-- Nullable so existing queued/processing/completed jobs (created before this
-- migration) backfill to NULL. NULL hashes don't match any non-NULL hash in
-- the dedup check, so they're treated as "always re-render" — a safe
-- fallback (worst case: one extra FFmpeg run).

ALTER TABLE "RenderJob" ADD COLUMN "timelineHash" TEXT;

CREATE INDEX "RenderJob_timelineHash_idx" ON "RenderJob"("timelineHash");
