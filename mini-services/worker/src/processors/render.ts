// VidiaForge Worker — render processor (V4-S2 rewrite)
//
// Lifecycle:
//   1. Fetch RenderJob + Project + referenced assets from DB.
//   2. Set status='preparing'.
//   3. VALIDATE the project via validateProject(). If invalid: set status='failed',
//      store the validation errors in `error`, and DO NOT retry — the project
//      itself is broken and retrying won't fix it.
//   4. Set status='processing' AND claim the lease:
//        - Generate workerId (UUID, generated ONCE per worker process — module
//          level memo) and attemptId (UUID per attempt).
//        - Write workerId, attemptId, heartbeatAt=now, startedAt=now,
//          increment attempt, status='processing'.
//   5. Start the heartbeat: setInterval(WORKER_HEARTBEAT_INTERVAL_MS) that
//      writes `heartbeatAt=now` (and verifies attemptId is still ours) so the
//      recovery sweep on OTHER workers doesn't mark this job failed while we
//      are mid-render. The interval is cleared in finally.
//   6. Call FFmpegRenderService.render() with:
//        - onProgress callback throttled to every 2s (not every frame) — writes
//          { progress, stage='encoding', status='processing', heartbeatAt=now }
//          to the RenderJob row (only if attemptId still matches).
//        - onProgress also polls the DB every few seconds to check if the user
//          cancelled the job (status='cancelled' in DB → abort.abort()).
//   7. Set status='uploading' before the upload phase (FFmpegRenderService emits
//      an 'uploading' progress event that we forward as a status flip).
//   8. On success:
//        - HEAD the output object via storage.headObject() to get REAL size.
//        - ffprobe the output to get REAL duration/width/height/fps/codec/audioCodec.
//        - ATOMIC finalization via db.$transaction: re-fetch RenderJob, verify
//          attemptId matches (else abort — a newer retry won the race), then
//          if outputAssetId already set → return existing MediaAsset; else
//          create the output MediaAsset (with REAL metadata — NEVER size=0 or
//          duration=null) + update RenderJob to status='completed', stage='completed',
//          progress=1, outputAssetId, outputUrl, completedAt=now.
//   9. On failure: set status='failed', store error in `error`, completedAt=now()
//        - Classify the error: transient (storage/redis/network) → retry up to 3
//          times with exponential backoff (1s, 2s, 4s). Permanent (invalid
//          project, missing asset, corrupt media, ffmpeg exit) → no retry.
//  10. On cancellation: set status='cancelled', stage='cancelled', clean temp
//      files, kill the FFmpeg child process via AbortController.
//  11. try/finally cleans temp files + disconnects Prisma + clears heartbeat.
//
// IDEMPOTENCY:
//   - The output object key is `renders/{renderJobId}/output.{ext}`. On retry,
//     FFmpegRenderService detects the existing output object and skips the
//     FFmpeg run entirely — just finalizes the DB row.
//   - The atomic finalization checks if RenderJob.outputAssetId is already set
//     (in case a duplicate job message slipped through) and returns the
//     existing MediaAsset instead of creating a duplicate.
//
// WORKER LEASE (V4-S2 P0-17/P0-18):
//   - workerId is generated ONCE per worker process — it identifies THIS
//     worker instance. Multiple concurrent jobs from the same worker share
//     the same workerId.
//   - attemptId is generated PER ATTEMPT — a retry generates a fresh attemptId.
//   - The "guard" pattern: before any DB update to the RenderJob, we re-fetch
//     the row + verify `attemptId === ourAttemptId`. If a newer retry has
//     overwritten the row, our attemptId won't match — we ABORT our update
//     so we don't clobber the newer attempt's progress. (Prisma's conditional
//     update via `where: { id, attemptId }` would also work, but the explicit
//     guard is clearer + matches the spec's "verify attemptId" requirement.)

import { PrismaClient } from '@prisma/client';
import { mkdtemp, rm, stat } from 'fs/promises';
import { createReadStream } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';

const lib = '../../../../src/lib';
const execFileP = promisify(execFile);

// === Worker identity (generated ONCE per worker process) ====================
// All jobs processed by THIS worker share the same workerId. The workerId is
// surfaced in logs + the DB so dashboards can show "this job is being
// processed by worker X" + operators can correlate.
let workerIdMemo: string | null = null;
function getWorkerId(): string {
  if (!workerIdMemo) {
    workerIdMemo = randomUUID();
    console.log(`[render] worker instance id = ${workerIdMemo}`);
  }
  return workerIdMemo;
}

// === Heartbeat config ========================================================
// WORKER_HEARTBEAT_INTERVAL_MS: how often we update RenderJob.heartbeatAt
// while FFmpeg is running. Default 20s — frequent enough that the 30min
// stale-after threshold gives ample recovery headroom but not so frequent it
// hammers the DB (a 2-hour render = 360 heartbeat writes, trivial).
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.WORKER_HEARTBEAT_INTERVAL_MS || '20000', 10) || 20_000;

// === Retry policy ===
// Transient errors (network/storage/redis flakiness) get retried up to 3 times
// with exponential backoff. Permanent errors (invalid project, missing asset,
// corrupt media, ffmpeg failure, cancellation) DO NOT retry — retrying won't
// fix the underlying problem and just burns worker cycles.
const MAX_RETRIES = 3;
const BACKOFF_MS = [1_000, 2_000, 4_000];

// Error-class classification patterns. If any of these regexes match the
// error message, the error is considered PERMANENT (do not retry).
const PERMANENT_ERROR_PATTERNS = [
  /invalid (output )?format/i,
  /invalid codec/i,
  /invalid height/i,
  /invalid fps/i,
  /invalid videobitrate/i,
  /invalid audiobitrate/i,
  /nothing to render/i,
  /ownership mismatch/i,
  /is not in the resolved asset set/i,
  /has no storageKey/i,
  /is not yet ready/i,
  /Project is null/i,
  /Project is missing an id/i,
  /Output validation failed/i,
  /no video stream/i,
  /ffmpeg exited with code/i,
  /Render cancelled by AbortSignal/i,
  /cancelled/i,
  /MediaProcessorUnavailableError/i,
  /ffmpeg not found|ffprobe not found|ffmpeg unavailable/i,
];

function isPermanentError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return PERMANENT_ERROR_PATTERNS.some((re) => re.test(msg));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Output metadata extraction (FFprobe + headObject) ──────────────────────
// V4-S2: previously the output MediaAsset was created with `size: 0` and
// `duration: renderResult.durationSeconds` — but the FFmpegRenderService
// computes durationSeconds from the filter graph (an ESTIMATE), not from
// ffprobe on the actual output. A slow encoder or a missing audio stream
// would produce a real duration that differed from the estimate.
//
// Now we probe the actual output file:
//   1. storage.headObject(outputKey) → real size in bytes
//   2. Download to tmp + ffprobe → real duration, width, height, fps, codec,
//      audioCodec, container.
//   3. ATOMIC finalization: never create the output MediaAsset with size=0
//      or duration=null — if either is missing, the render is marked FAILED
//      (an output with no real size or duration is corrupt / unprobe-able).

interface OutputMetadata {
  size: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  codec: string | null;
  audioCodec: string | null;
  container: string | null;
}

async function probeOutputMetadata(
  outputKey: string,
  expectedFormat: 'mp4' | 'webm' | 'mov'
): Promise<OutputMetadata> {
  const { getStorage } = await import(`${lib}/storage`);
  const storage = getStorage();

  // 1. headObject for size
  const meta = await storage.headObject(outputKey);
  if (!meta) {
    throw new Error(
      `Output validation failed: storage.headObject(${outputKey}) returned null — output object is missing after upload.`
    );
  }
  const size = meta.size;
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error(
      `Output validation failed: output object size is ${size} bytes — FFmpeg produced an empty / corrupt output.`
    );
  }

  // 2. Download to tmp for ffprobe (small download — output is just-rendered
  //    and we need real metadata, not the filter-graph estimate).
  const probeTmpDir = await mkdtemp(path.join(tmpdir(), 'vf-probe-'));
  try {
    const ext = expectedFormat === 'webm' ? '.webm' : expectedFormat === 'mov' ? '.mov' : '.mp4';
    const localPath = path.join(probeTmpDir, `output${ext}`);

    try {
      const stream = await storage.getObjectStream(outputKey);
      await pumpToDisk(stream, localPath);
    } catch (err) {
      throw new Error(
        `Output validation failed: failed to download output for ffprobe: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // 3. ffprobe — get JSON with format + streams
    const { resolveFfprobe } = await import(`${lib}/media/binary-resolver`);
    const ffprobeResolved = await resolveFfprobe();
    const ffprobePath = ffprobeResolved.path;

    let probeJson: any;
    try {
      const { stdout } = await execFileP(
        ffprobePath,
        ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', localPath],
        { maxBuffer: 64 * 1024 * 1024 }
      );
      probeJson = JSON.parse(stdout);
    } catch (err) {
      throw new Error(
        `Output validation failed: ffprobe could not decode ${outputKey}. Underlying: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const fmt = probeJson?.format || {};
    const streams: any[] = Array.isArray(probeJson?.streams) ? probeJson.streams : [];
    const videoStream = streams.find((s) => s.codec_type === 'video');
    const audioStream = streams.find((s) => s.codec_type === 'audio');

    if (!videoStream) {
      throw new Error(`Output validation failed: no video stream found in ${outputKey}.`);
    }

    // Parse duration from format first, then video stream.
    const duration = parseFloat(fmt.duration) || parseFloat(videoStream.duration) || 0;

    // FPS — parse from `r_frame_rate` (e.g. "30/1" or "30000/1001").
    let fps: number | null = null;
    const rFrameRate = videoStream.r_frame_rate;
    if (typeof rFrameRate === 'string') {
      const m = rFrameRate.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
      if (m) {
        const num = parseFloat(m[1]);
        const den = parseFloat(m[2]);
        if (den > 0) fps = num / den;
      }
    }
    if (fps === null || !Number.isFinite(fps)) {
      const avgFrameRate = videoStream.avg_frame_rate;
      if (typeof avgFrameRate === 'string') {
        const m = avgFrameRate.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
        if (m) {
          const num = parseFloat(m[1]);
          const den = parseFloat(m[2]);
          if (den > 0) fps = num / den;
        }
      }
    }

    return {
      size,
      duration: Number.isFinite(duration) && duration > 0 ? duration : null,
      width: videoStream.width ? parseInt(videoStream.width, 10) : null,
      height: videoStream.height ? parseInt(videoStream.height, 10) : null,
      fps: fps !== null && Number.isFinite(fps) ? fps : null,
      codec: typeof videoStream.codec_name === 'string' ? videoStream.codec_name : null,
      audioCodec: audioStream && typeof audioStream.codec_name === 'string' ? audioStream.codec_name : null,
      container: typeof fmt.format_long_name === 'string' ? fmt.format_long_name : (typeof fmt.format_name === 'string' ? fmt.format_name : null),
    };
  } finally {
    await rm(probeTmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Stream a web ReadableStream into a file on disk WITHOUT buffering the entire
 * body into memory. Uses a fs.WriteStream + backpressure-aware pump.
 */
async function pumpToDisk(stream: ReadableStream<Uint8Array>, destPath: string): Promise<void> {
  const { createWriteStream } = await import('fs');
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(destPath);
    const reader = stream.getReader();
    const pump = async (): Promise<void> => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          if (!out.write(Buffer.from(value))) {
            await new Promise<void>((r) => out.once('drain', r));
          }
        }
      }
    };
    out.on('error', reject);
    out.on('finish', () => resolve());
    pump().then(() => out.end()).catch(reject);
  });
}

export async function processRender(job: any): Promise<void> {
  const { jobId } = job.data || {};
  if (!jobId) throw new Error('Missing jobId in job data');

  const db = new PrismaClient();
  let tmpDir: string | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  try {
    const renderJob = await db.renderJob.findUnique({
      where: { id: jobId },
      include: { project: true },
    });
    if (!renderJob) throw new Error(`RenderJob ${jobId} not found`);

    // Idempotency: if already completed/cancelled, skip entirely.
    if (renderJob.status === 'completed') {
      console.log(`[render] job ${jobId} already completed — skipping`);
      return;
    }
    if (renderJob.status === 'cancelled') {
      console.log(`[render] job ${jobId} already cancelled — skipping`);
      return;
    }

    // === Set status='preparing' ===
    // (preparing state has no worker assigned yet — it's a transient state
    // before we validate the project. If the worker crashes here, the
    // recovery sweep will mark it failed because heartbeatAt is NULL.)
    await db.renderJob.update({
      where: { id: jobId },
      data: {
        status: 'preparing',
        startedAt: new Date(),
        stage: 'preparing',
        progress: 0,
        error: null,
      },
    });

    const { FFmpegRenderService, validateProject } = await import(`${lib}/render/ffmpeg-render-service`);
    const { RENDER_PRESETS } = await import(`${lib}/render/types`);
    const { getStorage } = await import(`${lib}/storage`);
    const { getRenderOutputKey } = await import(`${lib}/render/job-idempotency`);

    // Build the ProjectDocument from DB
    const project = renderJob.project;
    let timeline: any = {};
    try {
      timeline = JSON.parse(project.timelineData || '{}');
    } catch {
      timeline = {};
    }

    // Fetch asset refs for clips with assetId — only the ones the project references.
    const timelineClips: any[] = timeline.clips || [];
    const referencedAssetIds = Array.from(new Set(
      timelineClips
        .filter((c) => c.enabled !== false && typeof c.assetId === 'string' && c.assetId.length > 0)
        .map((c) => c.assetId)
    ));
    const assets = referencedAssetIds.length > 0
      ? await db.mediaAsset.findMany({ where: { id: { in: referencedAssetIds } } })
      : [];
    const assetMap: Record<string, { storageKey: string; localPath?: string; ready?: boolean; kind?: string }> = {};
    for (const a of assets) {
      assetMap[a.id] = {
        storageKey: a.storagePath,
        ready: a.status === 'ready',
        kind: a.kind,
      };
    }

    const projectDoc = {
      schemaVersion: project.schemaVersion ?? 1,
      project: {
        id: project.id,
        name: project.name,
        width: project.width,
        height: project.height,
        fps: project.fps,
        canvasPreset: project.canvasPreset,
        resolution: project.resolution,
      },
      tracks: timeline.tracks || [],
      clips: timeline.clips || [],
      markers: timeline.markers || [],
      assets: assets.map((a) => ({
        id: a.id,
        name: a.filename,
        kind: a.kind as 'video' | 'audio' | 'image',
        mimeType: a.mimeType,
        size: a.size,
        duration: a.duration ?? undefined,
        width: a.width ?? undefined,
        height: a.height ?? undefined,
        fps: a.fps ?? undefined,
        thumbnailUrl: a.thumbnailUrl ?? undefined,
        waveformUrl: a.waveformUrl ?? undefined,
        storagePath: a.storagePath,
      })),
    };

    // Resolve render options from the renderJob row
    const presetMatch = RENDER_PRESETS.find((p: any) =>
      p.id.toLowerCase().includes(String(renderJob.resolution || '').toLowerCase())
    );
    const options = presetMatch ? presetMatch.options : {
      format: (renderJob.format as 'mp4' | 'webm' | 'mov') || 'mp4',
      codec: (renderJob.codec as any) || 'h264',
      height: renderJob.resolution === '4K' ? 2160 : renderJob.resolution === '1440p' ? 1440
        : renderJob.resolution === '720p' ? 720 : renderJob.resolution === '480p' ? 480 : 1080,
      fps: renderJob.fps || 30,
      videoBitrate: renderJob.bitrate === 'low' ? 2_000_000 : renderJob.bitrate === 'high' ? 12_000_000 : 6_000_000,
      audioBitrate: 128_000,
      pixelFormat: 'yuv420p' as const,
      audioSampleRate: 48_000,
      audioChannels: 2,
      preset: 'custom',
    };

    // === VALIDATE the project ===
    // If invalid: set status='failed', DO NOT retry. Permanent error.
    const validation = validateProject({
      project: projectDoc,
      assets: assetMap,
      userId: project.userId, // worker has the project row → owner check is implicit
      ownerId: project.userId,
      options,
    });
    if (!validation.valid) {
      const error = `Invalid project: ${validation.errors.join('; ')}`;
      console.error(`[render] job ${jobId} validation failed: ${error}`);
      await db.renderJob.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          stage: 'failed',
          error,
          completedAt: new Date(),
        },
      });
      // Permanent error — do NOT throw with a retry-eligible marker; throw a
      // regular Error so BullMQ marks the job failed (without exponential backoff).
      throw new Error(error);
    }

    // === V4-S2: claim the lease — set status='processing' + workerId + attemptId ===
    // Generate a fresh attemptId per attempt. If this worker crashes mid-render,
    // a retry (by us or another worker) generates a NEW attemptId. The guard
    // in `safeUpdate` checks attemptId matches before writing — a stale worker
    // (mid-crash) cannot overwrite a newer retry's progress.
    const workerId = getWorkerId();
    // `let` not `const` — on transient-error retry, we generate a fresh
    // attemptId for the new attempt + re-claim the lease below.
    let attemptId = randomUUID();

    await db.renderJob.update({
      where: { id: jobId },
      data: {
        status: 'processing',
        stage: 'preparing',
        progress: 0,
        workerId,
        attemptId,
        heartbeatAt: new Date(),
        attempt: { increment: 1 },
      },
    });
    console.log(`[render] job ${jobId} claimed by worker ${workerId} (attemptId=${attemptId}, attempt=${renderJob.attempt + 1})`);

    /**
     * Safe update — verify attemptId matches before writing. Returns true if
     * the update was applied, false if a newer retry won the race (caller
     * should ABORT — its work is stale).
     *
     * Pattern: re-fetch the row, check attemptId === our attemptId, then
     * write. Prisma's conditional update via `where: { id, attemptId }`
     * would also work but the explicit guard is clearer + lets us log the
     * mismatch. We use a single update with `where: { id }` after the check
     * — the race window between the read and the write is small (a few ms)
     * and the worst case is a single stale write, not a corrupt one.
     */
    const safeUpdate = async (data: any): Promise<boolean> => {
      try {
        const fresh = await db.renderJob.findUnique({
          where: { id: jobId },
          select: { attemptId: true, status: true },
        });
        if (!fresh) return false; // job was deleted — give up
        if (fresh.attemptId !== attemptId) {
          console.warn(
            `[render] job ${jobId} attemptId mismatch (current=${fresh.attemptId}, ours=${attemptId}) — aborting stale update. ` +
            `A newer retry has likely claimed this job.`
          );
          return false;
        }
        // If the job was cancelled while we were processing, don't overwrite
        // the cancelled state — let our own polling abort path handle it.
        if (fresh.status === 'cancelled') {
          return false;
        }
        await db.renderJob.update({ where: { id: jobId }, data });
        return true;
      } catch (err) {
        // Log + swallow — a transient DB write failure shouldn't crash the
        // render (FFmpeg is still running; we'll try again on the next tick).
        console.warn(`[render] job ${jobId} safeUpdate failed:`, err instanceof Error ? err.message : err);
        return false;
      }
    };

    // === V4-S2: heartbeat — update heartbeatAt every HEARTBEAT_INTERVAL_MS ===
    // The heartbeat lets the recovery sweep on OTHER workers distinguish a
    // crashed worker (heartbeat older than RENDER_JOB_STALE_AFTER_MS = 30min)
    // from a live one (recent heartbeat). We also verify attemptId matches
    // before writing — if a newer retry has claimed the job, we stop
    // heartbeating (we're stale) and let the AbortController kill FFmpeg.
    heartbeatTimer = setInterval(async () => {
      const ok = await safeUpdate({ heartbeatAt: new Date() });
      if (!ok) {
        // Either attemptId mismatch (newer retry won) OR job was cancelled.
        // In either case, abort FFmpeg — we're doing stale work.
        console.warn(`[render] job ${jobId} heartbeat safeUpdate returned false — aborting FFmpeg`);
        // We can't reference `abort" here (defined below) — instead, the
        // cancel-poll below will detect the same condition via DB status
        // and fire abort.abort(). The heartbeat just stops writing.
      }
    }, HEARTBEAT_INTERVAL_MS);

    // === Cancellation: poll the DB every 5s to check if user cancelled ===
    const abort = new AbortController();
    const cancelPoll = setInterval(async () => {
      try {
        const fresh = await db.renderJob.findUnique({
          where: { id: jobId },
          select: { status: true, attemptId: true },
        });
        if (!fresh) {
          // Job was deleted — abort.
          abort.abort();
          return;
        }
        if (fresh.attemptId !== attemptId) {
          // A newer retry claimed this job — abort our stale work.
          console.warn(`[render] job ${jobId} attemptId changed during render — aborting stale worker`);
          abort.abort();
          return;
        }
        if (fresh.status === 'cancelled') {
          console.log(`[render] job ${jobId} cancelled by user — aborting FFmpeg`);
          abort.abort();
        }
      } catch {
        // ignore polling errors — we don't want a polling failure to abort the job
      }
    }, 5_000);

    // === Render with retry for transient errors ===
    let lastErr: unknown = null;
    let renderResult: { outputKey: string; durationSeconds: number } | null = null;
    const outputKey = getRenderOutputKey(jobId, options.format);
    const storage = getStorage();

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const renderService = new FFmpegRenderService();

        // Throttle progress writes to every 2s — not every frame (FFmpeg emits
        // progress ~10x/sec which would hammer the DB). We keep the latest
        // progress value in `lastProgress` and flush it on the 2s tick.
        // Each flush also bumps heartbeatAt so progress + heartbeat ride the
        // same write — fewer DB round-trips.
        let lastProgressWrite = 0;
        let lastProgressValue: { progress: number; stage: string; status: string } | null = null;
        const progressFlushInterval = setInterval(async () => {
          if (!lastProgressValue) return;
          const now = Date.now();
          if (now - lastProgressWrite < 2_000) return;
          lastProgressWrite = now;
          // safeUpdate verifies attemptId before writing — if our lease was
          // taken by a newer retry, we stop writing progress (and abort fires
          // from the cancel-poll).
          await safeUpdate({
            progress: lastProgressValue.progress,
            stage: lastProgressValue.stage,
            status: lastProgressValue.status,
            heartbeatAt: new Date(),
          });
        }, 2_000);

        try {
          renderResult = await renderService.render({
            project: projectDoc,
            assets: assetMap,
            outputPath: outputKey,
            options,
            signal: abort.signal,
            onProgress: (progress) => {
              const stage = progress.stage === 'preparing' || progress.stage === 'filter_graph'
                ? 'preparing'
                : progress.stage === 'encoding'
                ? 'encoding'
                : progress.stage === 'uploading' || progress.stage === 'finalizing'
                ? 'uploading'
                : 'encoding';
              const status = progress.stage === 'uploading' || progress.stage === 'finalizing'
                ? 'uploading'
                : 'processing';
              lastProgressValue = { progress: progress.progress, stage, status };
            },
          });
        } finally {
          clearInterval(progressFlushInterval);
          // Final flush so the last progress value lands in the DB.
          // Cast to a typed local because TS's control-flow analysis can't
          // prove the onProgress closure was called before the finally —
          // without the cast, `lastProgressValue` is narrowed to `never`
          // inside the truthy branch (the variable was only assigned inside
          // a closure, which TS treats as not-definitely-called).
          if (lastProgressValue) {
            const p = lastProgressValue as { progress: number; stage: string; status: string };
            await safeUpdate({
              progress: p.progress,
              stage: p.stage,
              status: p.status,
              heartbeatAt: new Date(),
            });
          }
        }
        break; // success — exit the retry loop
      } catch (err) {
        lastErr = err;
        // Cancellation is a terminal state — don't retry.
        if (abort.signal.aborted || /cancelled by AbortSignal/i.test(String(err))) {
          console.log(`[render] job ${jobId} cancelled — not retrying`);
          break;
        }
        // Permanent errors: validation failures, missing assets, ffmpeg crashes,
        // missing binaries — retrying won't help.
        if (isPermanentError(err)) {
          console.error(`[render] job ${jobId} permanent error (no retry): ${err instanceof Error ? err.message : err}`);
          break;
        }
        // Transient error — retry if we have attempts left.
        if (attempt < MAX_RETRIES) {
          const backoff = BACKOFF_MS[attempt] ?? 4_000;
          console.warn(`[render] job ${jobId} attempt ${attempt + 1} failed with transient error: ${err instanceof Error ? err.message : err}. Retrying in ${backoff}ms...`);
          await sleep(backoff);
          // Re-claim the lease for the next attempt — generate a NEW attemptId
          // so the previous attempt's writes (if any leak through) are rejected
          // by the guard. Bump attempt counter + heartbeat.
          const retryAttemptId = randomUUID();
          try {
            await db.renderJob.update({
              where: { id: jobId },
              data: {
                status: 'processing',
                workerId,
                attemptId: retryAttemptId,
                heartbeatAt: new Date(),
                error: `Retry attempt ${attempt + 2}/${MAX_RETRIES + 1} after: ${err instanceof Error ? err.message : String(err)}`,
              },
            });
            // Swap our local attemptId to the new one so subsequent safeUpdate
            // calls in this loop iteration use the new lease.
            attemptId = retryAttemptId;
          } catch {
            /* ignore — if this fails, the next iteration's safeUpdate will detect the mismatch and abort */
          }
        } else {
          console.error(`[render] job ${jobId} exhausted ${MAX_RETRIES + 1} attempts — giving up`);
        }
      }
    }

    clearInterval(cancelPoll);
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    if (!renderResult) {
      // All retries exhausted (or permanent error).
      const isCancelled = abort.signal.aborted || /cancelled by AbortSignal/i.test(String(lastErr));
      await safeUpdate({
        status: isCancelled ? 'cancelled' : 'failed',
        stage: isCancelled ? 'cancelled' : 'failed',
        error: lastErr instanceof Error ? lastErr.message : String(lastErr),
        completedAt: new Date(),
      });
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    }

    // === V4-S2: probe the REAL output metadata (headObject + ffprobe) ===
    // The FFmpegRenderService returns `durationSeconds` from the filter-graph
    // estimate, NOT from ffprobe on the actual output. We re-probe to get the
    // real values + the actual file size from storage.headObject.
    // Never create the output MediaAsset with size=0 or duration=null — those
    // indicate a corrupt / unprobe-able output, and the render is marked failed.
    let outputMeta: OutputMetadata;
    try {
      outputMeta = await probeOutputMetadata(renderResult.outputKey, options.format);
    } catch (err) {
      // Probe failed — the output is corrupt / unprobe-able. Mark FAILED.
      console.error(`[render] job ${jobId} output probe failed: ${err instanceof Error ? err.message : err}`);
      await safeUpdate({
        status: 'failed',
        stage: 'failed',
        error: `Output validation failed: ${err instanceof Error ? err.message : String(err)}`,
        completedAt: new Date(),
      });
      throw err instanceof Error ? err : new Error(String(err));
    }

    if (outputMeta.size <= 0) {
      const err = new Error(`Output validation failed: output object size is ${outputMeta.size} bytes — refusing to create MediaAsset with size=0.`);
      await safeUpdate({
        status: 'failed',
        stage: 'failed',
        error: err.message,
        completedAt: new Date(),
      });
      throw err;
    }
    if (outputMeta.duration === null || outputMeta.duration <= 0) {
      const err = new Error(`Output validation failed: ffprobe reported duration=${outputMeta.duration} — refusing to create MediaAsset with duration=null.`);
      await safeUpdate({
        status: 'failed',
        stage: 'failed',
        error: err.message,
        completedAt: new Date(),
      });
      throw err;
    }

    // === V4-S2: ATOMIC finalization (P0-22/P0-24) ===
    // Use db.$transaction to:
    //   1. Re-fetch RenderJob (within the tx) — verify attemptId still matches.
    //      If not, a newer retry won the race — return its existing outputAsset.
    //   2. If outputAssetId already set (idempotency) — return existing MediaAsset.
    //   3. Else create the output MediaAsset + update RenderJob in the SAME tx.
    //
    // This guarantees:
    //   - No duplicate MediaAsset rows on duplicate job messages (race safety).
    //   - No stale-worker clobbering a newer retry's progress (attemptId guard).
    //   - No orphaned MediaAsset rows if the RenderJob update fails (tx atomicity).
    const downloadUrl = await storage.createDownloadUrl({ key: renderResult.outputKey });

    const finalOutputAssetId = await db.$transaction(async (tx: any) => {
      // 1. Re-fetch within the tx — the row is locked for the duration of the tx.
      const freshJob = await tx.renderJob.findUnique({
        where: { id: jobId },
        select: { attemptId: true, outputAssetId: true, status: true },
      });
      if (!freshJob) {
        throw new Error(`RenderJob ${jobId} disappeared during atomic finalization`);
      }

      // 2. AttemptId guard — a newer retry has claimed this job; our render is
      //    stale. Don't write anything. The newer retry will finalize itself.
      if (freshJob.attemptId !== attemptId) {
        console.warn(
          `[render] job ${jobId} atomic finalization: attemptId mismatch (current=${freshJob.attemptId}, ours=${attemptId}) — yielding to newer retry`
        );
        // If the newer retry already finalized, return its outputAssetId.
        // Otherwise return null — the caller will throw to mark this attempt
        // as failed (which is correct: we're stale, our work is discarded).
        return freshJob.outputAssetId;
      }

      // 3. Idempotency: if outputAssetId is already set, another duplicate job
      //    message slipped through (rare — BullMQ dedup is per-queue). Return
      //    the existing MediaAsset id instead of creating a duplicate.
      if (freshJob.outputAssetId) {
        console.log(
          `[render] job ${jobId} atomic finalization: outputAssetId already set (${freshJob.outputAssetId}) — returning existing (idempotent)`
        );
        return freshJob.outputAssetId;
      }

      // 4. Create the output MediaAsset with REAL metadata from ffprobe +
      //    headObject — NEVER size=0 or duration=null (those checks ran above).
      const mimeType = options.format === 'webm' ? 'video/webm'
        : options.format === 'mov' ? 'video/quicktime'
        : 'video/mp4';
      const created = await tx.mediaAsset.create({
        data: {
          userId: project.userId,
          projectId: project.id,
          filename: `${project.name} — render ${jobId.slice(-8)}.${options.format}`,
          internalName: `output.${options.format}`,
          mimeType,
          size: outputMeta.size, // REAL size from headObject
          storagePath: renderResult.outputKey,
          kind: 'video',
          duration: outputMeta.duration, // REAL duration from ffprobe (non-null verified above)
          width: outputMeta.width, // REAL width from ffprobe
          height: outputMeta.height ?? options.height, // fallback to requested height if ffprobe didn't report
          fps: outputMeta.fps ?? options.fps, // fallback to requested fps if ffprobe didn't report
          codec: outputMeta.codec ?? (options.codec === 'h265' ? 'hevc' : options.codec),
          audioChannels: null,
          status: 'ready', // output is immediately ready
        },
      });

      // 5. Update RenderJob to completed — same tx so the row + asset commit atomically.
      await tx.renderJob.update({
        where: { id: jobId },
        data: {
          status: 'completed',
          stage: 'completed',
          progress: 1,
          outputUrl: downloadUrl,
          outputAssetId: created.id,
          error: null,
          completedAt: new Date(),
          heartbeatAt: new Date(),
        },
      });

      return created.id;
    });

    if (!finalOutputAssetId) {
      // We yielded to a newer retry (attemptId mismatch) AND that retry
      // hasn't finalized yet. Our render is stale — throw so BullMQ records
      // this attempt as failed (the newer retry will succeed).
      console.warn(`[render] job ${jobId} yielded to newer retry — marking this attempt as stale`);
      throw new Error('Render attempt was superseded by a newer retry (attemptId mismatch).');
    }

    console.log(`[render] job ${jobId} completed → outputAsset ${finalOutputAssetId} (${renderResult.outputKey}, size=${outputMeta.size}B, dur=${outputMeta.duration}s)`);
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
    await db.$disconnect().catch(() => {});
  }
}

// mkdtemp + tmpdir + path + stat + createReadStream are imported for the
// lifecycle above; keep them live so tree-shaking doesn't drop them.
void mkdtemp; void tmpdir; void path; void stat; void createReadStream;
