# VidiaForge — Media Engine

> **Scope.** This document explains the end-to-end media pipeline:
> how an uploaded file becomes a renderable `MediaAsset`, how previews
> are generated, how renders are produced, and how errors surface.
>
> **Cross-reference.** See `docs/WORKER.md` for the worker's job lifecycle
> + queue architecture. See `docs/ARCHITECTURE.md` §5 + §6 for the
> high-level data flow diagrams. See `docs/DEPLOYMENT_NETLIFY_RENDER.md`
> for the storage provider setup (R2/S3/local).

---

## 1. Upload flow (browser → signed URL → S3 → finalize → MediaAsset)

### 1.1 Two upload paths

VidiaForge supports two upload paths:

1. **API-direct multipart upload** (`POST /api/assets/upload`)
   - The browser sends the file as `multipart/form-data` directly to
     the VidiaForge API.
   - The API streams the file to the configured storage provider
     (`LocalStorageProvider.putObject` for dev, `S3StorageProvider.putObject`
     for production).
   - Suitable for files up to ~500 MB. Above that, use the presigned URL
     path.

2. **Presigned URL upload** (production-only, S3/R2)
   - The browser asks the API for a presigned PUT URL
     (`POST /api/assets/upload-url`).
   - The API returns a presigned URL pointing directly at R2/S3.
   - The browser PUTs the file directly to R2/S3, bypassing the VidiaForge
     API entirely. No bandwidth costs through Render.
   - When the upload completes, the browser calls `POST /api/assets/finalize`
     with the storage key + content type + size. The API creates the
     `MediaAsset` row + enqueues the `media-ingestion` job.

### 1.2 State machine

```
[Browser] choose file
   │
   ▼
[API] verify MIME whitelist + 500 MB cap
   │  (video/mp4, video/webm, video/quicktime, audio/*, image/*)
   │
   ▼
[API] generate internalName = `${uuid}.${ext}`
   │
   ▼
[API] db.mediaAsset.create({
   │     status: "uploading",
   │     storagePath: "uploads/<userId>/<internalName>",
   │     ...
   │   })
   │
   ├── Path 1: API-direct (small files)
   │     │
   │     ▼
   │   [API] storage.putObject({ key: storagePath, body: stream })
   │     │
   │     ▼
   │   [API] enqueue("media-ingestion", { assetId })
   │
   ├── Path 2: Presigned URL (large files, production)
   │     │
   │     ▼
   │   [API] storage.createUploadUrl({ key, contentType })
   │     │  → returns presigned PUT URL (R2/S3)
   │     │
   │     ▼
   │   [Browser] PUT file directly to R2/S3
   │     │
   │     ▼
   │   [Browser] POST /api/assets/finalize { key, contentType, size,
   │                                          projectId, originalName }
   │     │
   │     ▼
   │   [API] enqueue("media-ingestion", { assetId })
   │
   ▼
[API] return MediaAsset DTO with status + errorMessage
   │
   ▼
[Worker] (see §2 — ingestion flow)
```

### 1.3 MediaAsset lifecycle states

The `MediaAsset.status` column tracks the asset through ingestion:

| State | Meaning | Transition |
|---|---|---|
| `uploading` | Initial state — file is being uploaded by the browser | Set on row creation |
| `processing` | Worker has picked up the `media-ingestion` job and is running FFprobe + thumbnail + waveform + proxy | Set by worker at start |
| `ready` | All ingestion steps succeeded — asset is renderable | Set by worker on success |
| `failed` | At least one ingestion step failed — see `errorMessage` for the reason | Set by worker on failure |

The API surfaces `status` + `errorMessage` in the `MediaAssetDTO` so the
frontend can render an honest "still processing" or "failed" badge
immediately after upload.

### 1.4 HONEST behavior when Redis is not configured

If `REDIS_URL` is not set (e.g. local dev), the API logs a `console.warn`
naming the asset id + the missing config + the worker setup step. The
asset row stays at `status: "uploading"` — the frontend shows a
"Configure REDIS_URL to enable media processing" message. NEVER silently
flip the status to "ready" without processing.

---

## 2. Ingestion flow (MEDIA_INGEST job → FFprobe → metadata → thumbnail → waveform → proxy → status=ready)

The worker's `media-ingestion` queue processor
(`mini-services/worker/src/processors/media-ingestion.ts`) runs the
following pipeline for each new `MediaAsset`:

### 2.1 Pipeline steps

```
[Worker] BLPOP queue:media-ingestion → job.data.assetId
   │
   ▼
[Worker] db.mediaAsset.findUnique(assetId)
   │  if not found → throw (BullMQ marks job failed)
   │
   ▼
[Worker] IDEMPOTENCY CHECK
   │  if asset.status === "ready" → log + return (skip)
   │  (a prior run already produced thumbnail/waveform/proxy)
   │
   ▼
[Worker] db.mediaAsset.update({ status: "processing", errorMessage: null,
   │                              failedAt: null })
   │  (clears any prior failure markers so a retry doesn't show stale errors)
   │
   ▼
[Worker] storage.getObjectStream(storagePath)
   │  → pumpToDisk(stream, /tmp/vf-mi-xxx/<internalName>.<ext>)
   │  (STREAMING download — never buffers into memory)
   │
   ▼
[Worker] media.probe(localPath) via ffprobe
   │  → { duration, width, height, fps, codec, audioChannels }
   │  → db.mediaAsset.update({ duration, width, height, fps, codec, audioChannels })
   │
   ▼
[Worker] IF kind === "video" OR kind === "image":
   │   media.generateThumbnail({ inputPath, atTime: min(1, duration*0.1), width: 640 })
   │   IF storage.objectExists("thumbnails/<assetId>.jpg"):
   │     db.mediaAsset.update({ thumbnailUrl: signedUrl("thumbnails/<assetId>.jpg") })
   │   ELSE:
   │     log warn (don't record a URL that doesn't exist)
   │
   ▼
[Worker] IF audioChannels > 0 (video with audio OR audio-only):
   │   media.generateWaveform({ inputPath, width: 1280, height: 120 })
   │   IF storage.objectExists("waveforms/<assetId>.png"):
   │     db.mediaAsset.update({ waveformUrl: signedUrl("waveforms/<assetId>.png") })
   │
   ▼
[Worker] IF kind === "video" AND height > 1080:
   │   media.generateProxy({ inputPath, maxHeight: 720, outputKey: "proxies/<assetId>.mp4" })
   │   IF storage.objectExists("proxies/<assetId>.mp4"):
   │     db.mediaAsset.create({
   │       filename: "<original> (720p proxy)",
   │       storagePath: "proxies/<assetId>.mp4",
   │       kind: "video", status: "ready",
   │       proxyAssetId: <original.id>   ← self-relation: proxy points to original
   │     })
   │     (original.proxyAssetId stays null — see §2.3 below)
   │
   ▼
[Worker] db.mediaAsset.update({ status: "ready" })
   │
   ▼
[Worker] try/finally: rm -rf tmpDir; db.$disconnect()
```

### 2.2 Existence verification (S2 honesty fix)

A subtle pre-S2 bug: the worker recorded `thumbnailUrl` / `waveformUrl` /
`proxyAssetId` immediately after calling the generator, WITHOUT verifying
that the storage write actually succeeded. If the storage write silently
failed (e.g. S3 credential issue, transient network error), the asset row
pointed at a non-existent URL.

The S2 rewrite adds `storage.objectExists(key)` checks before recording
each URL. If the check fails, the URL is NOT recorded — the asset stays
without a thumbnail/waveform/proxy URL rather than lying about it. The
next ingestion retry will try to regenerate.

### 2.3 Proxy media self-relation

The Prisma schema's `MediaAsset` model has a self-relation:

```prisma
model MediaAsset {
  proxyAssetId String?
  proxyFor     MediaAsset?  @relation("MediaAssetProxy", fields: [proxyAssetId], references: [id], onDelete: SetNull)
  proxies      MediaAsset[] @relation("MediaAssetProxy")
}
```

Semantics:

- The PROXY row has `proxyAssetId` pointing to the ORIGINAL.
- The ORIGINAL row's `proxyAssetId` is null.
- To find proxies for an original: `db.mediaAsset.findMany({ where: { proxyAssetId: original.id } })`.
- If the original is deleted, the proxy's `proxyAssetId` becomes null
  (SetNull — the proxy remains, just orphaned).

### 2.4 HONEST error reporting

On failure (any step throws), the worker:

1. Sets `status = "failed"`, `errorMessage = lastError.message`,
   `failedAt = new Date()`.
2. Re-throws the original error so BullMQ marks the job failed.
3. `try/finally` cleans up the temp dir + disconnects Prisma.

The API surfaces `errorMessage` in the `MediaAssetDTO` so the frontend
can render a "Retry" affordance or show the underlying FFmpeg error
message.

---

## 3. Proxy generation (original 4K → 720p H.264 proxy)

The worker generates a 720p H.264 proxy for video assets whose source
height exceeds 1080px. The proxy is used for:

- **Browser playback** — 4K source media won't play smoothly in the
  browser canvas; the 720p proxy is the playback source.
- **Render preview** — the editor's center-preview composites the proxy
  instead of the source for snappier scrubbing.
- **Render pipeline** — the worker uses the SOURCE media (not the proxy)
  for the final render to preserve quality.

### 3.1 FFmpeg command

```bash
ffmpeg -i <input> \
  -vf scale=-2:720 \
  -c:v libx264 -preset fast -crf 26 \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  -y <output.mp4>
```

The proxy is stored at `proxies/<assetId>.mp4` in object storage. The
worker creates a new `MediaAsset` row for the proxy (see §2.3).

### 3.2 Why 720p

- 720p H.264 at CRF 26 is ~1-2 MB per minute — small enough for
  smooth browser playback even on slow connections.
- 720p is the minimum resolution for which YouTube + TikTok accept
  uploads; the proxy doubles as a fallback export target.
- 720p H.264 decodes in real-time on virtually every device (no hardware
  decoder required).

---

## 4. Preview rendering (browser compositor — current state, honest about limitations)

The editor's center preview (`src/components/editor/center-preview.tsx`)
is a **browser-based compositor**. It plays back clips in real time using
HTML5 `<video>` + `<canvas>` + CSS transforms.

### 4.1 What works today

- **Single video clip playback** — `<video>` element with `currentTime`
  synced to the playhead.
- **Multiple audio tracks** — separate `<audio>` elements mixed via
  WebAudio `GainNode`.
- **Text overlays** — absolutely-positioned `<div>` elements with CSS
  transitions for animation.
- **Image overlays** — `<img>` with CSS `transform: scale(), translate(), rotate()`.
- **Opacity / blend modes** — CSS `opacity` + `mix-blend-mode`.
- **Cropping** — CSS `clip-path` or `overflow: hidden`.

### 4.2 Honest limitations

- **No real-time FFmpeg effects** — effects (blur, vignette, color grading)
  are NOT applied in the browser preview. They are applied during the
  server-side render via the FFmpeg filter graph. The browser preview
  shows the original clip; the rendered output applies the effects.
- **No real-time transitions** — transitions (cross-dissolve, fade, etc.)
  are NOT rendered in the browser preview. The preview plays clips back-
  to-back; transitions appear only in the rendered output.
- **No real-time captions burn-in** — captions are shown as overlay
  `<div>` elements in the preview; the rendered output burns them in via
  FFmpeg's `subtitles` filter.
- **No real-time speed changes** — clip `speed` is honored at render time
  via FFmpeg's `setpts` + `atempo` filters. The browser preview plays at
  1x speed regardless of the clip's speed setting.
- **WebCodecs render target (NOT implemented)** — the filter graph is
  structured (not a raw FFmpeg command string) so a WebCodecs-based
  renderer could consume it later. This is a target, not current state.

### 4.3 Why browser preview is intentionally limited

Real-time browser-based video compositing with FFmpeg-equivalent effect
quality is technically possible (via WebGL shaders + WebCodecs) but
requires substantial engineering effort. VidiaForge's current preview is
intentionally a **playback** layer, not a **render** layer — the server-
side render pipeline (FFmpeg) is the source of truth for output quality.
The preview is "good enough" for editorial decisions; the render is
"pixel-perfect" for delivery.

---

## 5. Render flow (POST /api/render → RenderJob → Redis → Worker → FFmpeg → uploadStream → verify → signed URL)

### 5.1 End-to-end pipeline

```
[Browser] POST /api/render { projectId, format, codec, resolution, fps, bitrate }
   │
   ▼
[API] getSessionUser() → 401 if missing
   │
   ▼
[API] getOwnedProject(projectId) → 404 / 403 if missing or not owned
   │
   ▼
[API] db.renderJob.create({ status: "queued", ... })
   │
   ▼
[API] enqueue("render", { jobId }) → REDIS_URL RPUSH queue:render
   │  IF REDIS_URL missing:
   │    db.renderJob.update({ status: "failed", error: "...", completedAt: now() })
   │    return 503 { error: "...", code: "RENDER_QUEUE_NOT_CONFIGURED" }
   │
   ▼
[API] return 201 { job: { id, status: "queued", ... }, queued: true, queueJobId: ... }
   │
   ▼
[Worker] BLPOP queue:render → job.data.jobId
   │
   ▼
[Worker] db.renderJob.findUnique(jobId)
   │  IDEMPOTENCY: if status === "completed" OR "cancelled" → log + return (skip)
   │
   ▼
[Worker] db.renderJob.update({ status: "preparing", stage: "preparing", progress: 0 })
   │
   ▼
[Worker] fetch Project + referenced MediaAssets
   │
   ▼
[Worker] validateProject({ project, assets, userId, ownerId, options })
   │  if invalid → db.renderJob.update({ status: "failed", error: errors.join("\n") })
   │              → return (NO RETRY — permanent error)
   │
   ▼
[Worker] db.renderJob.update({ status: "processing", stage: "filter_graph" })
   │
   ▼
[Worker] setup CANCELLATION POLLING: every 5s check renderJob.status
   │  if "cancelled" → abort.abort() → kills FFmpeg child
   │
   ▼
[Worker] setup PROGRESS FLUSHING: every 2s write latest progress to DB
   │  (NOT every frame — FFmpeg emits ~10 progress lines/sec)
   │
   ▼
[Worker] RETRY LOOP (max 4 attempts):
   │  attempt = 0
   │  while attempt < MAX_RETRIES:
   │    try:
   │      FFmpegRenderService.render({ project, assets, outputPath, options,
   │                                    onProgress, signal })
   │      ↓
   │      [FFmpegRenderService]:
   │        IDEMPOTENCY: if storage.objectExists(outputPath) → skip render
   │        DOWNLOAD sources via storage.getObjectStream (streaming)
   │        BUILD filter graph (SourceNode → TrimNode → ... → OutputNode)
   │        EMIT ffmpeg -filter_complex command
   │        SPAWN ffmpeg child process
   │        PARSE stderr: frame=N fps=N time=HH:MM:SS.xx
   │        → emit progress (throttled by worker to 2s DB writes)
   │        ON abort.signal → proc.kill("SIGTERM")
   │        ON exit code != 0 → reject("ffmpeg exited with code N: ...")
   │        VALIDATE output via ffprobe (7 checks: file/size/video/audio/
   │                                        duration/resolution/codec)
   │        UPLOAD output via storage.uploadStream(outputPath, readStream)
   │        VERIFY storage.objectExists(outputPath) — catches silent upload failures
   │      ↓
   │      db.renderJob.update({ status: "completed", progress: 1, outputUrl,
   │                            outputAssetId: <new MediaAsset>, completedAt: now() })
   │      break
   │    catch err:
   │      if cancelled → break (no retry)
   │      if PERMANENT error (matches PERMANENT_ERROR_PATTERNS) → break
   │      else transient → sleep BACKOFF_MS[attempt] (1s, 2s, 4s)
   │                       re-mark status="processing", retry
   │
   ▼
[Worker] try/finally: rm -rf tmpDir; db.$disconnect()
```

### 5.2 Render output validation (7 checks)

The `FFmpegRenderService.validateRenderOutput()` function runs after
FFmpeg exits 0. It throws on ANY check failure — only returns success if
ALL pass:

1. **File exists on disk** — `await stat(outputLocal)` succeeds.
2. **Size > 0** — `st.size > 0`.
3. **ffprobe can decode** — `ffprobe -v quiet -print_format json -show_streams`
   returns valid JSON.
4. **Video stream exists** — at least one stream with `codec_type === "video"`.
5. **Audio stream exists** (warns if missing — silent renders are valid
   but unusual; logged but not a hard failure).
6. **Duration within 10% of expected** — `|actual - expected| / expected < 0.10`.
7. **Resolution matches `options.height` within 1px** — `Math.abs(actual_height - options.height) <= 1`.
8. **Codec matches `options.codec` mapping** — h264 → `"h264"`, h265 → `"hevc"`,
   vp9 → `"vp9"`, av1 → `"av1"`.

If ffprobe is unavailable, validation fails open (warns + skips) so
renders aren't blocked on ffprobe missing — ffmpeg alone produces output.

### 5.3 Idempotency

The render pipeline is idempotent via deterministic output keys:

```typescript
// src/lib/render/job-idempotency.ts
export function getRenderOutputKey(renderJobId: string, format: string): string {
  const sanitized = renderJobId.replace(/[/\\.]/g, '');
  return `renders/${sanitized}/output.${format}`;
}
```

Same `renderJobId` always produces the same output key. The
`FFmpegRenderService.render()` checks `storage.objectExists(outputPath)`
at the top — if the output already exists (e.g. from a prior successful
attempt that failed during the DB write), the FFmpeg run is skipped and
the existing key is returned.

This makes renders retry-safe: a transient Redis/network failure causing
a BullMQ retry will find the prior output still in storage and finalize
the DB row cheaply.

### 5.4 Cancellation

The worker polls the render job's DB status every 5s. If the status is
`"cancelled"` (set by `POST /api/render/[id]/cancel`), the worker calls
`abort.abort()` on the `AbortSignal` passed to `FFmpegRenderService.render()`.

The render service's spawn loop listens for `signal.abort` and calls
`proc.kill('SIGTERM')` on the FFmpeg child process. The render service
rejects with `"Render cancelled by AbortSignal"` so the worker can
distinguish cancellation from real failure (cancelled → no retry,
real failure → retry per §5.5).

### 5.5 Retry logic

The worker's retry loop tries the render up to `MAX_RETRIES + 1 = 4`
times total. On each failure:

1. If cancelled → break (no retry).
2. If permanent error (matched against `PERMANENT_ERROR_PATTERNS` regex list)
   → break (no retry). Permanent error patterns include:
   - `invalid codec`
   - `nothing to render`
   - `Output validation failed`
   - `no video stream`
   - `ffmpeg exited with code`
   - `MediaProcessorUnavailableError`
   - `ffmpeg not found`
   - `cancelled`
3. Else transient (network/storage/redis flakiness) → sleep
   `BACKOFF_MS[attempt]` (1s, 2s, 4s exponential), re-mark `status="processing"`
   with the retry attempt count in `error`, retry.

After all retries exhausted, the job is marked `failed` with the last
error message.

### 5.6 Output MediaAsset creation

On successful render, the worker creates a new `MediaAsset` row for the
output:

```typescript
const outputAsset = await db.mediaAsset.create({
  data: {
    userId: project.userId,
    projectId: project.id,
    filename: `${project.name} - ${preset.label}.${format}`,
    internalName: `${renderJobId}.${format}`,
    mimeType: contentType,
    size: outputSize,
    storagePath: outputKey,
    kind: 'video',
    status: 'ready',
    duration: graph.duration,
    width: options.width,
    height: options.height,
    fps: options.fps,
    codec: options.codec,
  },
});
await db.renderJob.update({
  where: { id: jobId },
  data: { outputAssetId: outputAsset.id },
});
```

The UI can then list + download renders like any other media asset.

---

## 6. Export presets

The render pipeline supports 8 export presets defined in
`src/lib/render/types.ts` (`RENDER_PRESETS`):

| Preset ID | Label | Resolution | Codec | Video bitrate | Audio bitrate |
|---|---|---|---|---|---|
| `youtube-1080p` | YouTube 1080p | 1920×1080 @ 30fps | h264 | 8 Mbps | 192 kbps AAC |
| `youtube-4k` | YouTube 4K | 3840×2160 @ 30fps | h264 | 35 Mbps | 192 kbps AAC |
| `tiktok-9x16` | TikTok 9:16 | 1080×1920 @ 30fps | h264 | 5 Mbps | 128 kbps AAC |
| `instagram-reels` | Instagram Reels | 1080×1920 @ 30fps | h264 | 4 Mbps | 128 kbps AAC |
| `instagram-feed` | Instagram Feed | 1080×1080 @ 30fps | h264 | 3.5 Mbps | 128 kbps AAC |
| `youtube-shorts` | YouTube Shorts | 1080×1920 @ 30fps | h264 | 6 Mbps | 128 kbps AAC |
| `linkedin` | LinkedIn | 1920×1080 @ 30fps | h264 | 6 Mbps | 128 kbps AAC |
| `custom` | Custom | user-defined | user-defined | user-defined | user-defined |

Each preset maps to a `RenderOptions` object passed to
`FFmpegRenderService.render()`. The UI's export dialog
(`src/components/editor/export-dialog.tsx`) lets users pick a preset or
customize.

The `getPreset(id)` helper returns the preset for a given ID. The
`POST /api/render` route accepts a `preset` field; if provided, the
options are derived from the preset (overriding individual `format`/
`codec`/`resolution`/`fps`/`bitrate` fields).

---

## 7. Error handling

### 7.1 MediaAsset.status states

| State | Set by | Triggered by |
|---|---|---|
| `uploading` | API upload route | Row creation (initial state) |
| `processing` | Worker media-ingestion processor | Job started |
| `ready` | Worker media-ingestion processor | All ingestion steps succeeded |
| `failed` | Worker media-ingestion processor | Any step threw |

The `errorMessage` column captures the underlying error message; the
`failedAt` column timestamps the failure.

### 7.2 RenderJob.status states

| State | Set by | Triggered by |
|---|---|---|
| `queued` | API POST /api/render | Job created |
| `preparing` | Worker render processor | Job started, project fetched |
| `processing` | Worker render processor | Validation passed, FFmpeg starting |
| `encoding` | Worker render processor (via `stage`) | FFmpeg running |
| `uploading` | Worker render processor (via `stage`) | FFmpeg done, output uploading |
| `completed` | Worker render processor | All checks passed, output uploaded + verified |
| `failed` | Worker render processor | Validation failed OR all retries exhausted |
| `cancelled` | API POST /api/render/[id]/cancel | User-initiated cancel |

The `progress` column (0..1) and `stage` column ("preparing" |
"encoding" | "uploading" | "completed" | "failed") provide real-time
feedback to the frontend.

### 7.3 Retry logic

See §5.5. The worker retries transient errors (network, storage, redis
flakiness) up to 3 times with exponential backoff (1s, 2s, 4s).
Permanent errors (invalid codec, validation failure, MediaProcessorUnavailableError)
do NOT retry.

### 7.4 Error codes

The API returns stable error codes in 503/500 responses. The codes
relevant to the media engine:

| Code | HTTP | Meaning |
|---|---|---|
| `MEDIA_NOT_FOUND` | 404 | Asset ID doesn't exist |
| `MEDIA_NOT_READY` | 409 | Asset still `uploading` or `processing` — wait for ingestion |
| `MEDIA_INGESTION_FAILED` | 500 | Asset `failed` during ingestion — check `errorMessage` |
| `STORAGE_ERROR` | 500 | Storage provider call failed |
| `STORAGE_NOT_CONFIGURED` | 503 | `STORAGE_PROVIDER` env var invalid or required vars missing |
| `RENDER_FAILED` | 500 | Render pipeline failed after all retries |
| `RENDER_CANCELLED` | 200 | Render cancelled by user (NOT an error) |
| `RENDER_QUEUE_NOT_CONFIGURED` | 503 | `REDIS_URL` env var missing — worker cannot run |
| `INVALID_PROJECT` | 422 | Project validation failed (no enabled clips, asset not ready, etc.) |

The frontend can switch on `code` and call
`mapErrorCodeToUserMessage(code, fallback)` for a friendly actionable
message.

---

## 8. Storage providers

### 8.1 Local (default for dev)

`LocalStorageProvider` writes objects to the local filesystem under
`UPLOAD_DIR` (default `./uploads`).

- `createUploadUrl` returns a JWT-signed URL pointing to
  `/api/assets/upload-direct` (the API handles the upload).
- `createDownloadUrl` returns a relative URL `/api/assets/by-key/<key>`
  (the API Range-streams).
- `putObject` writes a `Buffer` directly to `fs.writeFile`, OR pumps a
  web `ReadableStream` into a `fs.WriteStream`.
- `getObject` returns a web `ReadableStream` backed by `fs.createReadStream`.
- `uploadStream` pipes a `ReadableStream` into a `fs.WriteStream`
  (never buffers into memory).
- `getObjectStream` returns a web `ReadableStream` with optional byte range.
- `deleteObject` calls `fs.unlink` (best-effort — no throw on missing).
- `objectExists` calls `fs.access`.
- `getPublicUrl` returns `null` — local files are not publicly accessible.

### 8.2 S3 / R2 / MinIO

`S3StorageProvider` uses `@aws-sdk/client-s3` for non-streaming operations
and `@aws-sdk/lib-storage` for streaming uploads. The SDKs are loaded
via dynamic `await import()` so missing packages don't crash the app at
boot (they surface a clear actionable error on first use).

- `createUploadUrl` returns a real presigned PUT URL via
  `@aws-sdk/s3-request-presigner` (the browser uploads directly to R2/S3).
- `createDownloadUrl` returns a real presigned GET URL.
- `putObject` uses `PutObjectCommand`.
- `getObject` uses `GetObjectCommand` with optional `Range` header.
- `uploadStream` uses `@aws-sdk/lib-storage`'s `Upload` class
  (multipart upload, 5+ MB parts) — the CRITICAL fix for large files.
- `getObjectStream` uses `GetObjectCommand` with `Range` header,
  returning the SDK's response Body as a web `ReadableStream`.
- `deleteObject` uses `DeleteObjectCommand`.
- `objectExists` uses `HeadObjectCommand` (returns `false` on 404).
- `getPublicUrl` returns `${STORAGE_PUBLIC_BASE_URL}/${key}` if set,
  else `null`.

### 8.3 Provider selection

The `getStorage()` factory reads `STORAGE_PROVIDER` env var:

- `local` (default, case-insensitive) → `LocalStorageProvider`
- `s3` or `r2` → `LazyS3Provider` (defers SDK construction until first
  method call — missing `@aws-sdk/*` packages don't crash the app at
  boot; they surface a clear actionable error on first use)
- Any other value → `throw new Error('Unknown STORAGE_PROVIDER ...')`

The factory memoizes the provider so repeated calls return the same
instance.
