# VidiaForge — Worker Service

> **Scope.** This document explains the background worker: its
> architecture, queues, jobs, FFmpeg/FFprobe discovery, startup
> validation, concurrency model, retry logic, cancellation, cleanup,
> health endpoint, logging, and Docker deployment.
>
> **Source.** `mini-services/worker/src/index.ts` is the entry point.
> Processors live in `mini-services/worker/src/processors/`. Shared
> library code lives in `src/lib/` (imported via relative path
> `../../../../src/lib/...`).

---

## 1. Architecture

VidiaForge's worker is a **BullMQ-based background process** that
consumes jobs from Redis queues. It is NOT a Next.js process — it's a
standalone Bun script that imports the shared library code (storage,
media, render) and connects directly to PostgreSQL + Redis + object
storage.

```
                        ┌─────────────────────────┐
                        │   Redis                 │
                        │   (queue:media-ingestion│
                        │    queue:render         │
                        │    queue:transcription  │
                        │    queue:thumbnail      │
                        │    queue:proxy          │
                        │    queue:ai)            │
                        └────────────┬────────────┘
                                     │ BLPOP
                                     ▼
            ┌────────────────────────────────────────────┐
            │  VidiaForge Worker (Bun + Docker)         │
            │                                            │
            │  ┌──────────────────────────────────┐    │
            │  │ Pre-flight validation (parallel)  │    │
            │  │  - Redis ping                    │    │
            │  │  - PostgreSQL SELECT 1            │    │
            │  │  - Storage access (local dir /    │    │
            │  │    S3 env vars)                   │    │
            │  │  - MediaBinaryResolver: ffmpeg    │    │
            │  │  - MediaBinaryResolver: ffprobe   │    │
            │  │  - Import bullmq module          │    │
            │  │                                   │    │
            │  │  IF any fails → log JSON health   │    │
            │  │  report → process.exit(1)        │    │
            │  │  ELSE → log "VIDIAFORGE WORKER   │    │
            │  │   READY"                          │    │
            │  └──────────────────────────────────┘    │
            │                                            │
            │  ┌──────────────────────────────────┐    │
            │  │ BullMQ Workers (one per queue)   │    │
            │  │  - media-ingestion worker        │    │
            │  │  - render worker                  │    │
            │  │  - transcription worker           │    │
            │  │  - thumbnail worker              │    │
            │  │  - proxy worker                   │    │
            │  │  - ai worker (placeholder)        │    │
            │  │                                   │    │
            │  │  Each worker has WORKER_CONCURRENCY│   │
            │  │  concurrent job slots (default 2)  │    │
            │  └──────────────────────────────────┘    │
            │                                            │
            │  ┌──────────────────────────────────┐    │
            │  │ HTTP /health server on port 3001 │    │
            │  │  GET /health → 200 JSON          │    │
            │  │  { status, workers, time }        │    │
            │  └──────────────────────────────────┘    │
            │                                            │
            │  ┌──────────────────────────────────┐    │
            │  │ Graceful shutdown                │    │
            │  │  - SIGTERM/SIGINT listener        │    │
            │  │  - Worker.close() for each        │    │
            │  │  - redisConn.quit()                │    │
            │  │  - prismaClient.$disconnect()     │    │
            │  │  - process.exit(0)                │    │
            │  └──────────────────────────────────┘    │
            └────────────────────────────────────────────┘
                                     │
                                     ▼
                        ┌─────────────────────────┐
                        │  Object storage         │
                        │  (R2 / S3 / local FS)   │
                        └─────────────────────────┘
```

---

## 2. Queues

Six BullMQ queues are defined in `src/lib/queue-names.ts`:

| Queue name | Constant | Producer | Consumer |
|---|---|---|---|
| `media-ingestion` | `QUEUE_NAMES.MEDIA_INGEST` | `POST /api/assets/upload`, `POST /api/assets/finalize` | `processMediaIngestion` |
| `render` | `QUEUE_NAMES.RENDER` | `POST /api/render` | `processRender` |
| `transcription` | `QUEUE_NAMES.TRANSCRIPTION` | `POST /api/ai/transcribe` | `processTranscription` |
| `thumbnail` | `QUEUE_NAMES.THUMBNAIL` | (target) — when user re-generates a thumbnail | `processThumbnailOnly` |
| `proxy` | `QUEUE_NAMES.PROXY` | (target) — when user re-generates a 720p proxy | `processProxyOnly` |
| `ai` | `QUEUE_NAMES.AI` | (target) — generic AI jobs (highlights, remove-bg, etc.) | placeholder (logs + returns) |

The worker creates one `Worker` instance per queue, all sharing the same
Redis connection. The worker's `runningWorkerNames` array tracks which
queues are active — surfaced via `GET /health`.

---

## 3. Jobs + processors

### 3.1 `processMediaIngestion`

**Trigger.** `POST /api/assets/upload` (API-direct multipart) OR
`POST /api/assets/finalize` (browser-direct-to-S3) enqueues
`{ assetId }`.

**Processor.** `mini-services/worker/src/processors/media-ingestion.ts`
→ `processMediaIngestion`.

**Steps.**

1. Fetch `MediaAsset` row by `assetId`.
2. Idempotency check: if `status === "ready"` already, log + return.
3. Set `status = "processing"`, clear `errorMessage` + `failedAt`.
4. Download the source via `storage.getObjectStream()` +
   `pumpToDisk()` (streaming, no buffering).
5. `media.probe(localPath)` via ffprobe → store duration/width/height/fps/codec/audioChannels.
6. If `kind === "video"` or `kind === "image"`: generate thumbnail
   at `thumbnails/<assetId>.jpg` (640px wide JPEG). Verify
   `storage.objectExists(thumbnailKey)` before recording `thumbnailUrl`.
7. If `audioChannels > 0`: generate waveform at
   `waveforms/<assetId>.png` (1280×120 PNG). Verify existence before
   recording `waveformUrl`.
8. If `kind === "video"` AND `height > 1080`: generate 720p H.264 proxy
   at `proxies/<assetId>.mp4`. Verify existence. Create a NEW
   `MediaAsset` row for the proxy with `proxyAssetId` pointing to the
   original (per the schema's `MediaAssetProxy` self-relation).
9. Set `status = "ready"`.
10. `try/finally`: `rm -rf tmpDir`, `db.$disconnect()`.

**Failure.** On any step throwing: set `status = "failed"` +
`errorMessage` + `failedAt`, then re-throw so BullMQ marks the job
failed.

### 3.2 `processRender`

**Trigger.** `POST /api/render` enqueues `{ jobId }`.

**Processor.** `mini-services/worker/src/processors/render.ts`
→ `processRender`.

**Steps.**

1. Fetch `RenderJob` + `Project` + referenced `MediaAssets`.
2. Idempotency check: if `status === "completed"` or `"cancelled"`, log + return.
3. Set `status = "preparing"`, `stage = "preparing"`, `progress = 0`,
   clear `error`.
4. Call `validateProject({ project, assets, userId, ownerId, options })`.
   If invalid: set `status = "failed"`, store the validation errors in
   `error`, return (NO RETRY — permanent error).
5. Set `status = "processing"`.
6. Start cancellation polling (every 5s, checks if `renderJob.status === "cancelled"`).
7. Start throttled progress flushing (every 2s, writes latest progress to DB).
8. Retry loop (max 4 attempts):
   - Call `FFmpegRenderService.render({ project, assets, outputPath, options, onProgress, signal })`.
   - On success: set `status = "completed"`, `progress = 1`, `outputUrl`,
     `outputAssetId` (new MediaAsset row), `completedAt = now()`. Break.
   - On failure:
     - If cancelled → break (no retry).
     - If permanent error (matches `PERMANENT_ERROR_PATTERNS`) → break.
     - Else transient → sleep `BACKOFF_MS[attempt]` (1s, 2s, 4s),
       re-mark `status = "processing"`, retry.
9. `try/finally`: clean temp files + disconnect Prisma. Flush final progress.

See `docs/MEDIA_ENGINE.md` §5 for the full render pipeline details.

### 3.3 `processTranscription`

**Trigger.** `POST /api/ai/transcribe` enqueues `{ aiJobId, assetId }`.

**Processor.** `mini-services/worker/src/processors/transcription.ts`
→ `processTranscription`.

**Steps.**

1. Fetch the `AIJob` row + the referenced `MediaAsset`.
2. Resolve the `TranscriptionProvider` (openai, deepgram, or local).
3. Download the source asset via `storage.getObjectStream()` +
   `pumpToDisk()`.
4. Call `provider.transcribe(localPath, options)` → `CaptionCue[]`.
5. Store the cues as JSON in `AIJob.output`.
6. Set `AIJob.status = "completed"`, `completedAt = now()`.
7. `try/finally`: clean temp files + disconnect Prisma.

**Failure.** On error: set `AIJob.status = "failed"`, `error = message`,
re-throw.

### 3.4 `processThumbnailOnly`

**Trigger.** (target) — user clicks "Regenerate thumbnail" in the editor.

**Processor.** Same file as media-ingestion → `processThumbnailOnly`.

**Steps.** Same as §3.1 step 6, but only the thumbnail generation +
existence verification. Does NOT touch the asset's `status` (only
`thumbnailUrl`).

### 3.5 `processProxyOnly`

**Trigger.** (target) — user clicks "Regenerate proxy" in the editor.

**Processor.** Same file as media-ingestion → `processProxyOnly`.

**Steps.** Same as §3.1 step 8, but only the proxy generation +
existence verification + new `MediaAsset` row creation.

### 3.6 `processAI` (placeholder)

**Trigger.** (target) — generic AI jobs (highlights, remove-bg,
audio-cleanup, edit, translate, reframe).

**Processor.** Inline in `mini-services/worker/src/index.ts` →
`async (job) => console.log('[worker:ai] job received:', job.id)`.

This is a placeholder. Only AI jobs whose `kind` is in
`SUPPORTED_AI_JOBS` (`src/lib/ai/supported-jobs.ts`) are enqueued by
the API. The `POST /api/ai/edit` route uses the LLM directly (no
worker) and returns an `unsupported[]` array for commands whose `type`
is NOT in `COMMAND_TYPES`.

---

## 4. FFmpeg/FFprobe discovery (MediaBinaryResolver — 4-tier)

The `MediaBinaryResolver` (`src/lib/media/binary-resolver.ts`)
resolves the `ffmpeg` and `ffprobe` executables in priority order:

1. **Env var override** — `FFMPEG_PATH` / `FFPROBE_PATH` (explicit; wins if set).
2. **npm package** — `ffmpeg-static` (default export = path string) /
   `ffprobe-static` (`{ path: string }` keyed by platform). Loaded via
   dynamic `await import()` so missing packages don't crash the app at
   boot.
3. **System PATH** — `command -v ffmpeg` (Unix) / `where ffmpeg` (Windows).
4. **Container default paths** — `/usr/bin/ffmpeg`, `/usr/local/bin/ffmpeg`
   (and the `ffprobe` equivalents). Used by the official `worker.Dockerfile`
   which installs FFmpeg via Alpine's `apk add ffmpeg`.

On first successful resolution, the resolver:

- Logs `[media:binary-resolver] ffmpeg → /usr/bin/ffmpeg (source=container-default, "ffmpeg version 6.0 ...")`.
- Memoizes the result (subsequent calls return the cache).
- Mirrors the resolution into `process.env.FFMPEG_PATH` / `FFPROBE_PATH`
  (so the legacy `FFmpegMediaProcessor.which()` helper uses the same
  binary — single source of truth).

On failure (no candidate found), throws `MediaBinaryUnavailableError`
listing every source tried:

```
MediaBinaryUnavailableError: [ffmpeg] no usable ffmpeg binary found. Tried:
  - env FFMPEG_PATH (not set)
  - npm package ffmpeg-static (not installed)
  - system PATH (ffmpeg not on PATH)
  - container default /usr/bin/ffmpeg
  - container default /usr/local/bin/ffmpeg

Fix: set FFMPEG_PATH, install the ffmpeg-static npm package, install ffmpeg
system-wide, or use a Docker image that includes ffmpeg (e.g.
oven/bun:1-alpine + `apk add ffmpeg`).
```

---

## 5. Startup validation (Redis/PG/Storage/FFmpeg/FFprobe checks)

The worker's `main()` function runs pre-flight checks **in parallel**
before starting any BullMQ worker:

```typescript
const [redisCheck, dbCheck, storageCheck, binaryCheck] = await Promise.all([
  checkRedis(),
  checkDatabase(),
  checkStorage(),
  checkFfmpegBinaries(),
]);

const bullmqLoaded = await loadBullMQ();

const health: StartupHealth = {
  redis: redisCheck.ok,
  database: dbCheck.ok,
  storage: storageCheck.ok,
  ffmpeg: binaryCheck.ffmpeg.ok,
  ffprobe: binaryCheck.ffprobe.ok,
  ffmpegPath: binaryCheck.ffmpeg.path,
  ffprobePath: binaryCheck.ffprobe.path,
  ffmpegVersion: binaryCheck.ffmpeg.version,
  ffprobeVersion: binaryCheck.ffprobe.version,
  storageProvider: storageCheck.provider,
  errors: [],
};

if (!redisCheck.ok) health.errors.push(`redis: ${redisCheck.error}`);
if (!dbCheck.ok) health.errors.push(`database: ${dbCheck.error}`);
if (!storageCheck.ok) health.errors.push(`storage: ${storageCheck.error}`);
if (!binaryCheck.ffmpeg.ok) health.errors.push(`ffmpeg: ${binaryCheck.ffmpeg.error}`);
if (!binaryCheck.ffprobe.ok) health.errors.push(`ffprobe: ${binaryCheck.ffprobe.error}`);
if (!bullmqLoaded) health.errors.push('bullmq: module not installed');

console.log('[worker] startup health report:');
console.log(JSON.stringify(health, null, 2));

const allOk = health.redis && health.database && health.storage &&
              health.ffmpeg && health.ffprobe && bullmqLoaded;
if (!allOk) {
  console.error('[worker] STARTUP FAILED — missing required dependencies:');
  for (const e of health.errors) console.error(`  - ${e}`);
  console.error('[worker] refusing to start. Fix the above and redeploy.');
  process.exit(1);
}

await setupWorkers();
console.log(`[worker] running queues: ${runningWorkerNames.join(', ')}`);

startHealthServer();
setupShutdown();

console.log('VIDIAFORGE WORKER READY');
```

### 5.1 What each check does

- **`checkRedis()`** — reads `REDIS_URL`, creates an `ioredis` client
  with `maxRetriesPerRequest: null` (BullMQ requirement), `connectTimeout:
  5000ms`, `retryStrategy: times => Math.min(times * 200, 2000)`. Calls
  `redisConn.ping()` — returns `{ ok: true }` on `PONG`, otherwise
  `{ ok: false, error: "Failed to ping Redis at ...: ..." }` (URL
  credentials masked in the error message).
- **`checkDatabase()`** — reads `DATABASE_URL`, creates a `PrismaClient`
  with `log: ['error']` (production) or `['error', 'warn']` (dev). Calls
  `prismaClient.$queryRaw\`SELECT 1\`` — cheapest possible liveness check.
- **`checkStorage()`** — reads `STORAGE_PROVIDER`:
  - `local` — accesses `UPLOAD_DIR` (default `./uploads`); if missing,
    tries `mkdir(uploadDir, { recursive: true })` then re-accesses.
  - `s3` / `r2` — checks that `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`,
    `STORAGE_SECRET_KEY` are all set. Does NOT do a network HEAD bucket
    call (would slow startup + require network egress).
- **`checkFfmpegBinaries()`** — calls `resolveFfmpeg()` and
  `resolveFfprobe()` from `MediaBinaryResolver`. Returns both paths +
  versions (or error messages).
- **`loadBullMQ()`** — `await import('bullmq')`. Catches `ERR_MODULE_NOT_FOUND`
  → returns `false` with a clear "run `bun install` inside
  `mini-services/worker/`" message.

### 5.2 The `VIDIAFORGE WORKER READY` signal

The string `VIDIAFORGE WORKER READY` is logged ONLY after every check
passes + `setupWorkers()` completes + the health server is listening +
the shutdown handler is wired. If you see this string in the worker
logs, the worker is fully operational. If you don't, the worker exited
with code 1 — read the JSON health report above for the failure cause.

---

## 6. Concurrency (WORKER_CONCURRENCY env var, default 2)

The worker creates one `Worker` instance per queue. Each `Worker` has
`concurrency: WORKER_CONCURRENCY` (parsed from env var, default 2).

```typescript
const concurrency = parseInt(process.env.WORKER_CONCURRENCY || '2', 10) || 2;
console.log(`[worker] concurrency=${concurrency} (from WORKER_CONCURRENCY)`);

for (const name of QUEUE_NAMES) {
  const handler = processors[name];
  if (!handler) continue;
  const w = new Worker(name, handler, {
    connection: redisConn,
    concurrency,
  });
  // ...
}
```

**Semantics.** Each worker processes up to `concurrency` jobs in
parallel. With 6 queues × 2 concurrency = up to 12 jobs in flight
simultaneously. For FFmpeg-heavy workloads, increase `WORKER_CONCURRENCY`
to 4 or 8 — but watch CPU + RAM usage (FFmpeg's `libx264` encoder is
CPU-bound; 4 parallel renders on a 4-CPU Render instance will saturate
the CPUs).

**Render-specific concurrency note.** Render jobs are CPU + RAM
intensive (FFmpeg child process + tmp disk for source media + tmp disk
for output). On Render's `Standard` plan (2 GB RAM), keep
`WORKER_CONCURRENCY = 2`. On `Standard+` (4 GB RAM), 4 is safe.

---

## 7. Retry logic (exponential backoff, permanent vs transient errors)

BullMQ has its own retry config (set per-queue at the API side via
`enqueue()` options). The render processor has an ADDITIONAL in-job
retry loop because FFmpeg failures are often transient (network, storage
flakiness) and BullMQ's retry-from-scratch would re-download source
media unnecessarily.

### 7.1 Render processor retry loop

```typescript
const MAX_RETRIES = 3; // 4 total attempts
const BACKOFF_MS = [1000, 2000, 4000]; // exponential

for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  try {
    await FFmpegRenderService.render({ ... });
    // success path
    return;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isCancelled = msg.includes('cancelled') || signal.aborted;
    const isPermanent = PERMANENT_ERROR_PATTERNS.some(p => p.test(msg));

    if (isCancelled) {
      // Don't retry — user cancelled
      break;
    }
    if (isPermanent) {
      // Don't retry — codec missing, validation failure, etc.
      break;
    }
    if (attempt < MAX_RETRIES) {
      // Transient — sleep + retry
      await sleep(BACKOFF_MS[attempt]);
      await db.renderJob.update({
        where: { id: jobId },
        data: { status: 'processing', error: `Retry attempt ${attempt + 1}: ${msg}` },
      });
      continue;
    }
    // Exhausted retries
    break;
  }
}

// Mark failed (after the loop exits without a success)
await db.renderJob.update({
  where: { id: jobId },
  data: { status: 'failed', stage: 'failed', error: lastErr.message, completedAt: new Date() },
});
throw lastErr; // Re-throw so BullMQ marks the job failed too
```

### 7.2 Permanent error patterns

The `PERMANENT_ERROR_PATTERNS` regex list (in
`mini-services/worker/src/processors/render.ts`) includes:

- `invalid codec`
- `nothing to render`
- `Output validation failed`
- `no video stream`
- `ffmpeg exited with code`
- `MediaProcessorUnavailableError`
- `ffmpeg not found`
- `cancelled`

If the error message matches any of these, the job is marked failed
immediately — retrying won't help.

### 7.3 Media-ingestion processor

The media-ingestion processor relies on BullMQ's built-in retry config
(no in-job retry loop). BullMQ retries up to N times with exponential
backoff (configured at enqueue time). The processor just throws on
failure — BullMQ handles the retry scheduling.

---

## 8. Cancellation (abort signal → kill FFmpeg)

The render processor polls the render job's DB status every 5s. If the
status is `"cancelled"` (set by `POST /api/render/[id]/cancel`):

```typescript
const abort = new AbortController();
const cancelPoll = setInterval(async () => {
  const fresh = await db.renderJob.findUnique({ where: { id: jobId } });
  if (fresh?.status === 'cancelled') {
    abort.abort();
    clearInterval(cancelPoll);
  }
}, 5000);

try {
  await FFmpegRenderService.render({
    ...,
    signal: abort.signal,
  });
} finally {
  clearInterval(cancelPoll);
}
```

The render service's spawn loop listens for `signal.abort`:

```typescript
const onAbort = () => {
  try { child.kill('SIGTERM'); } catch { /* ignore */ }
};
input.signal?.addEventListener('abort', onAbort, { once: true });

// ...

child.on('close', (code) => {
  input.signal?.removeEventListener('abort', onAbort);
  if (input.signal?.aborted) {
    reject(new Error('Render cancelled by AbortSignal'));
    return;
  }
  // ...
});
```

On abort:

1. The worker's polling loop detects `status === "cancelled"` and calls
   `abort.abort()`.
2. The render service's `onAbort` handler calls `child.kill('SIGTERM')`
   on the FFmpeg child process.
3. FFmpeg receives SIGTERM and exits (typically within 100ms).
4. The render service's `child.on('close')` handler detects
   `input.signal?.aborted === true` and rejects with
   `"Render cancelled by AbortSignal"`.
5. The render processor catches the rejection, detects `isCancelled`
   (the message contains "cancelled"), and breaks out of the retry loop
   (no retry on cancellation).
6. The render job's `status` is already `"cancelled"` in the DB (set by
   the cancel API route) — the worker doesn't need to update it again.

### 8.1 Cleanup on cancellation

The render service's `try/finally` block always runs — even on
cancellation:

```typescript
try {
  // ... FFmpeg spawn + parse + upload ...
} finally {
  // Clean up tmp dir
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
}
```

This ensures the temp directory (containing the downloaded source
media + the rendered output) is removed even if the render was
cancelled mid-flight. The `force: true` flag means missing files don't
throw.

---

## 9. Cleanup (try/finally for temp files)

Every processor uses `try/finally` to clean up temp files + Prisma
connections:

```typescript
let tmpDir: string | null = null;
try {
  tmpDir = await mkdtemp(path.join(tmpdir(), 'vf-...'));
  // ... process ...
} finally {
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  await db.$disconnect().catch(() => {});
}
```

The `.catch(() => {})` ensures cleanup failures don't mask the original
error — if `rm` fails (e.g. permission issue), we still want the
original error to surface.

---

## 10. Health endpoint (GET /health on port 3001)

The worker runs a tiny HTTP server on port `WORKER_PORT` (default 3001):

```typescript
function startHealthServer() {
  const PORT = parseInt(process.env.WORKER_PORT || '3001', 10);
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        workers: runningWorkerNames,
        time: new Date().toISOString(),
      }));
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  });
  server.listen(PORT, () => {
    console.log(`[worker] health server on http://localhost:${PORT}/health`);
  });
  return server;
}
```

Render's `worker` service type does NOT run HTTP health checks by
default (unlike `web` services). To verify the worker is alive:

1. Use Render's shell: `render shell vidiaforge-worker` →
   `curl http://localhost:3001/health`.
2. Or watch the worker logs for `VIDIAFORGE WORKER READY` at startup +
   `[worker:media-ingestion] job ... completed` lines during operation.
3. Or set up a sidecar `web` service that pings the worker's `/health`
   via the internal Render network.

---

## 11. Logging (structured, jobId/projectId/userId/status)

The worker uses `console.log` / `console.error` with structured prefixes:

| Prefix | Example | When |
|---|---|---|
| `[worker]` | `[worker] VidiaForge worker starting...` | Boot + shutdown |
| `[worker:redis]` | `[worker:redis] error: ...` | Redis connection errors |
| `[worker:bullmq]` | `[worker:bullmq] failed to import bullmq. Run \`bun install\`...` | BullMQ module load failure |
| `[worker:media-ingestion]` | `[worker:media-ingestion] asset abc123 already ready — skipping` | Media-ingestion processor |
| `[worker:render]` | `[worker:render] job xyz789 completed` | Render processor |
| `[worker:ai]` | `[worker:ai] job received: ...` | AI processor (placeholder) |
| `[media:binary-resolver]` | `[media:binary-resolver] ffmpeg → /usr/bin/ffmpeg ...` | FFmpeg/FFprobe resolution |
| `[render]` | `[render] output already exists at ... — skipping render (idempotent)` | Render service internal |

The structured JSON health report at boot is also logged:

```json
[worker] startup health report:
{
  "redis": true,
  "database": true,
  "storage": true,
  "ffmpeg": true,
  "ffprobe": true,
  "ffmpegPath": "/usr/bin/ffmpeg",
  "ffprobePath": "/usr/bin/ffprobe",
  "ffmpegVersion": "ffmpeg version 6.0 ...",
  "ffprobeVersion": "ffprobe version 6.0 ...",
  "storageProvider": "s3",
  "errors": []
}
```

Per-job logging includes the `jobId` (BullMQ job id, NOT the
RenderJob/MediaAsset id) so you can correlate worker logs with DB rows:

- `POST /api/render` creates a RenderJob row + enqueues `{ jobId: renderJob.id }`.
- The worker's `processRender` fetches the RenderJob by `job.data.jobId`.
- Worker logs use the BullMQ `job.id` (a Redis-generated id) + the
  RenderJob id (passed in `job.data.jobId`).

URL credentials in `REDIS_URL` / `DATABASE_URL` are masked in log
messages via the `maskUrl()` helper:

```typescript
function maskUrl(url: string): string {
  try {
    return url.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
  } catch {
    return '[unparseable url]';
  }
}
```

---

## 12. Docker deployment (worker.Dockerfile)

The worker ships as a multi-stage Docker image:

### 12.1 Build stages

| Stage | Base | Purpose |
|---|---|---|
| `deps` | `oven/bun:1-alpine` | Install root deps (`bun install --frozen-lockfile`) |
| `worker-deps` | `oven/bun:1-alpine` | Install worker deps (`bun install --frozen-lockfile` with fallback to fresh install) |
| `build` | `oven/bun:1-alpine` | Merge both `node_modules` trees + `bun run build` + `bunx prisma generate` + prune root devDependencies |
| `runner` | `oven/bun:1-alpine` | Install FFmpeg + ffprobe + DejaVu fonts + wget + libc6-compat; copy build artifacts + worker source + shared lib code |

### 12.2 Build-time verification

The runner stage asserts that FFmpeg + ffprobe are installed correctly:

```dockerfile
RUN ffmpeg -version && ffprobe -version && echo "FFmpeg + ffprobe verified OK"
```

If the Alpine package mirror serves a broken FFmpeg (rare but possible),
the build fails loudly — by design, so a broken base image never ships a
silent no-op worker.

It also verifies the worker entry point exists:

```dockerfile
RUN ls /app/mini-services/worker/src/index.ts && \
    echo "worker entry point verified: /app/mini-services/worker/src/index.ts"
```

This catches the S1 critical bug (commented-out `COPY mini-services/`)
at build time, not at runtime.

### 12.3 Runtime image contents

The final image (`runner` stage) contains:

- `/app/.next/standalone/` — Next.js standalone build (worker doesn't run server.js but spec requires this COPY).
- `/app/.next/static/` — static assets (safety net).
- `/app/public/` — manifest, icons, robots.txt.
- `/app/prisma/` — Prisma schema + migrations (worker doesn't run migrations but needs the schema for `prisma generate` if invoked manually).
- `/app/package.json` — required so `bun run worker:start` resolves.
- `/app/mini-services/` — worker source tree (CRITICAL — was the S1 bug).
- `/app/src/` — shared library code (worker imports `../../../../src/lib/...`).
- `/app/node_modules/` — root deps (production-pruned) + Prisma-generated client + worker-only deps MERGED via `cp -r /app/mini-services/worker/node_modules/. /app/node_modules/`.
- `/app/uploads/`, `/app/tmp/`, `/app/cache/` — runtime directories (pre-created with correct ownership).
- `ffmpeg` + `ffprobe` + DejaVu fonts (installed via `apk add`).

### 12.4 CMD

```dockerfile
CMD ["bun", "run", "worker:start"]
```

The root `package.json` defines:

```json
"worker:start": "cd mini-services/worker && bun run src/index.ts"
```

So inside the container, the CMD runs:

```bash
cd /app/mini-services/worker && bun run src/index.ts
```

which starts the worker entry point at
`/app/mini-services/worker/src/index.ts`.

### 12.5 Local build + run

```bash
# Build
docker build -t vidiaforge-worker:latest -f worker.Dockerfile .

# Run (with env vars from .env)
docker run --rm --env-file .env vidiaforge-worker:latest

# Verify inside the container (interactive)
docker run --rm -it vidiaforge-worker:latest /bin/sh
ls /app/mini-services/worker/src/index.ts   # must succeed
which ffmpeg                                  # /usr/bin/ffmpeg
ffmpeg -version                              # ffmpeg version 6.x ...
```

### 12.6 Render deploy

The `render.yaml` blueprint declares the worker as a `worker` service
with `runtime: docker` + `dockerfilePath: ./worker.Dockerfile`. See
`docs/DEPLOYMENT_NETLIFY_RENDER.md` §8 for the full deployment steps.
