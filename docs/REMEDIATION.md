# VidiaForge — Remediation Log

> Purpose: catalogue every problem identified in the production remediation review
> (15 items, labelled A through O), capture root cause + remediation approach +
> current status, and document the migration strategy + compatibility invariants.
> This file is the **source of truth** for what has been done, what is
> architecture-ready (configs exist but infra not provisioned), and what is
> genuinely pending.

---

## Status legend

| Tag | Meaning |
|---|---|
| **Fixed** | Code/config exists in this repo and works in the sandbox today |
| **Architecture-ready** | Configs/interfaces exist and are syntactically valid, but require real infrastructure (PostgreSQL, Redis, FFmpeg binary, S3) to actually run |
| **Pending infra** | Same as Architecture-ready, but specifically called out where no code change is required — only infrastructure provisioning + env vars |
| **Pending code** | Source change still required (out of scope for this task; tracked as a follow-on) |

---

## Problem index

| ID | Problem | Status |
|---|---|---|
| A | Simulated export (no real output file produced) | Architecture-ready |
| B | No FFmpeg binary in the runtime | Architecture-ready |
| C | No WebCodecs compositing in-browser (preview is static) | Pending code |
| D | Simulated captions (no real transcription) | Architecture-ready |
| E | Simulated translation (no real provider call) | Architecture-ready |
| F | Local filesystem storage (`/home/z/my-project/uploads`) | Architecture-ready |
| G | SQLite (no PostgreSQL) | Architecture-ready |
| H | No Netlify/Render split (single-process deployment) | Architecture-ready |
| I | Incomplete PWA (manifest yes, service worker no) | Pending code |
| J | Incomplete offline (no IndexedDB sync, no outbox replay) | Pending code |
| K | Incomplete media metadata (no FFprobe parsing) | Architecture-ready |
| L | Incomplete camera/screen capture (API stubbed) | Pending code |
| M | AI commands not connected (LLM returns commands but UI is mock) | Pending code |
| N | Hardcoded `/home/z/my-project` paths | Fixed |
| O | `ignoreBuildErrors: true` in `next.config.ts` | Documented (intentional) |

---

## Problem A — Simulated export

**Symptom**: `POST /api/render` creates a `RenderJob` row with `status: "queued"` but no
real video file is ever produced. The client polls `PATCH /api/render/[id]` with fake
progress and a fake `outputUrl`, then pretends the render is complete.

**Root cause**: The MVP deferred the render worker because (a) FFmpeg is not available
in the Next.js sandbox, (b) the worker needs OS-level packages (fonts, codec libraries)
that don't fit in a serverless function, and (c) the queue/worker split wasn't a
priority for the initial UI build.

**Remediation approach**:
- Add a real Render Blueprint (`render.yaml`) declaring a `worker` service with
  `startCommand: bun run worker:start` and a Docker image that includes FFmpeg
  (`worker.Dockerfile`).
- Worker consumes `queue:render` (Redis `BLPOP`), builds an FFmpeg filtergraph from the
  project's `TimelineState`, encodes to MP4/WebM, uploads the result to object storage,
  and patches `RenderJob.{status, outputUrl, progress, completedAt}` via the existing
  `PATCH /api/render/[id]` endpoint.
- The browser side changes from "fake progress" to "real progress polling" — same API
  contract, different values.

**Status**: **Architecture-ready**. The worker code itself (`mini-services/worker/`) is
**not** included in this task — it is documented honestly in `ARCHITECTURE.md` §4.3 +
§6. The configs (`render.yaml`, `worker.Dockerfile`, `docker-compose.yml`) are real and
will run as soon as the worker source is added.

---

## Problem B — No FFmpeg binary in the runtime

**Symptom**: `ffmpeg` and `ffprobe` are not installed; no render or media analysis can
happen server-side.

**Root cause**: The current dev environment is a Next.js-only sandbox; media processing
was deferred.

**Remediation approach**:
- `Dockerfile` and `worker.Dockerfile` install `ffmpeg`, `ffprobe`, `font-dejavu`,
  `ttf-dejavu-core` via `apk add` (Alpine).
- `worker.Dockerfile` includes a build-time verification step (`ffmpeg -version` +
  `ffprobe -version`) so a broken base image fails fast.
- `docker-compose.yml` includes the same image for local dev; the `app` service does
  not strictly need FFmpeg (it only serves the API), but the `worker` service does.

**Status**: **Architecture-ready**. Dockerfiles are valid and will install FFmpeg once
built.

---

## Problem C — No WebCodecs compositing in-browser

**Symptom**: The center preview canvas in the editor renders clips as static
HTML/SVG elements. There is no real frame-by-frame compositing using the browser's
`WebCodecs` API (`VideoEncoder`, `VideoDecoder`, `VideoFrame`).

**Root cause**: WebCodecs compositing is a large front-end undertaking (frame
scheduling, off-screen canvas, GPU path, color management). It was deferred in favor
of the server-side FFmpeg path which is more portable.

**Remediation approach**:
- **Out of scope for this task** (would require `src/` changes which are forbidden here).
- Target design: a `PreviewCompositor` class that uses `WebCodecs.VideoDecoder` to
  decode frames from proxy MP4s, composites them onto an `OffscreenCanvas` with the
  same effect/filter/transition pipeline as the FFmpeg filtergraph, and renders at
  ~30 fps via `requestAnimationFrame`.
- Server-side rendering (Problem A/B) takes precedence: WebCodecs preview is a UX
  enhancement, not a correctness requirement. The editor remains usable with the static
  preview today.

**Status**: **Pending code**. Documented in `ARCHITECTURE.md` §2.1.

---

## Problem D — Simulated captions

**Symptom**: The captions panel lets the user click "Auto-transcribe" but produces
hard-coded sample cues rather than calling a real transcription provider.

**Root cause**: No `TRANSCRIPTION_PROVIDER` was wired. The `AIJob.kind = "transcribe"`
schema exists but no worker job type implements it.

**Remediation approach**:
- `TranscriptionProvider` interface (`transcribe(audioStream): Promise<CaptionCue[]>`)
  with adapters for: OpenAI Whisper, Deepgram, AssemblyAI, local Whisper.cpp.
- Provider selection via `TRANSCRIPTION_PROVIDER` env var.
- Worker job `AI_TRANSCRIBE` resolves audio → calls provider → patches `AIJob.output`
  with `CaptionCue[]`.
- Frontend captions panel replaces the simulated "Auto-transcribe" with a real call to
  `POST /api/ai/transcribe` (target endpoint, see `ARCHITECTURE.md` §4.3).

**Status**: **Architecture-ready**. `.env.example` declares `TRANSCRIPTION_PROVIDER` +
`TRANSCRIPTION_API_KEY`; worker job type documented; provider implementation pending
infra + code.

---

## Problem E — Simulated translation

**Symptom**: The captions panel offers a "Translate" dropdown with 13 languages but
returns a mock translation.

**Root cause**: Same as D — no `TRANSLATION_PROVIDER` was wired.

**Remediation approach**:
- `TranslationProvider` interface with adapters for: DeepL, Google Translate,
  OpenAI / Anthropic via LLM translation, LibreTranslate (self-hosted).
- Worker job `AI_TRANSLATE` resolves captions → calls provider → patches `AIJob.output`.
- Frontend reads translated `CaptionCue[]` and re-renders.

**Status**: **Architecture-ready**. `.env.example` declares `TRANSLATION_PROVIDER` +
`TRANSLATION_API_KEY`.

---

## Problem F — Local filesystem storage

**Symptom**: `src/app/api/assets/upload/route.ts` hard-codes
`const UPLOAD_DIR = '/home/z/my-project/uploads'` and writes the file with
`fs.writeFile`. `MediaAsset.storagePath = "uploads/<uuid>.<ext>"`.

**Root cause**: Local FS is the simplest possible storage backend for development,
and the storage abstraction was deferred.

**Remediation approach**:
- Introduce a `StorageProvider` interface:
  ```ts
  interface StorageProvider {
    putObject(key: string, body: Buffer | ReadableStream, contentType: string): Promise<{ etag: string }>
    getObject(key: string): Promise<ReadableStream>
    signUrl(key: string, ttlSeconds: number): Promise<string>
    deleteObject(key: string): Promise<void>
  }
  ```
- Adapters: `LocalStorageProvider` (current behavior, used when
  `STORAGE_PROVIDER=local`), `S3StorageProvider` (Cloudflare R2 / AWS S3 / MinIO),
  `GcsStorageProvider` (future).
- Selection by `STORAGE_PROVIDER` env var.
- Upload route calls `storage.putObject("media/source/<userId>/<internalName>", buf, mime)`
  instead of `fs.writeFile`.
- Asset GET endpoint calls `storage.signUrl(key, 3600)` and 302-redirects, instead of
  reading from local FS.
- **Note**: implementing `StorageProvider` requires `src/` changes which are out of
  scope for this task. The configs that declare the storage env vars (`.env.example`,
  `render.yaml`, `Dockerfile`/`docker-compose.yml` volumes) are real and ready.

**Status**: **Architecture-ready**. The hardcoded path is also addressed by Problem N
below.

---

## Problem G — SQLite

**Symptom**: `prisma/schema.prisma` declares `provider = "sqlite"` and the dev database
lives at `file:/home/z/my-project/db/custom.db`.

**Root cause**: SQLite is the zero-config dev default; PostgreSQL requires a running
server.

**Remediation approach**:
- The schema itself is **already PostgreSQL-compatible** (uses only `String`, `Int`,
  `Float`, `Boolean`, `DateTime`, `Json`-as-`String`, `@id @default(cuid())`,
  `@updatedAt`, `@@index`, `onDelete: Cascade`). No SQLite-specific pragmas.
- Migrate by changing one line: `provider = "postgresql"` + pointing `DATABASE_URL`
  at the Render Postgres instance.
- `render.yaml` declares a `postgresql` resource (`vidiaforge-db`); `docker-compose.yml`
  declares a `postgres:15-alpine` service for local dev.
- Once on Postgres, run `bun run db:migrate` to create real migrations (currently we
  use `db:push` because SQLite has no migration history).

**Status**: **Architecture-ready**. Schema-compatible; no source change required
beyond the provider line in `prisma/schema.prisma` (deliberately left as `sqlite` so
the current sandbox keeps working — switching it is a one-line deploy-time change).

---

## Problem H — No Netlify/Render split

**Symptom**: The repo is a single Next.js app intended to be deployed as one unit.
There is no separation between the static frontend (Netlify) and the API + worker
(Render).

**Root cause**: Initial deployment was a single-process app; production needs
edge-cached frontend + long-running API + long-running worker.

**Remediation approach**:
- `netlify.toml`: deploy the same Next.js codebase to Netlify with
  `@netlify/plugin-nextjs` for SSR/SSG support. Netlify serves the App Router pages.
- `render.yaml`: deploy the **same** codebase to Render as a `web` service running
  `bun .next/standalone/server.js`. Render serves `/api/*` (the API routes).
- The `NEXT_PUBLIC_API_URL` env var tells the browser where to send API calls — it
  points to the Render origin in production, to `/` (same-origin) in dev.
- `render.yaml` also declares the `worker` service (`vidiaforge-worker`) which runs
  the FFmpeg pipeline; this is the same Docker image as the web service but with
  `startCommand: bun run worker:start` and a different set of env vars.
- **Routing decision**: in production, Netlify serves HTML + static assets; Render
  serves `/api/*`. A simple `rewrites` rule in `netlify.toml` (or `next.config.ts`)
  forwards `/api/*` to `NEXT_PUBLIC_API_URL`. (See `netlify.toml` §Rewrites.)

**Status**: **Architecture-ready**. Both `netlify.toml` and `render.yaml` are valid
and deployable.

---

## Problem I — Incomplete PWA

**Symptom**: `public/manifest.webmanifest` + icons exist; `beforeinstallprompt` is
captured in the landing page; **but no `sw.js` is registered**. The install button
works but the app has no real offline capability.

**Root cause**: Service worker registration was deferred to a follow-on task; the
manifest alone gives installability but not offline behavior.

**Remediation approach**:
- Add `public/sw.js` with a Workbox-style precache of the shell + runtime cache for
  `/_next/static/*` (1-year immutable).
- Register from `src/app/layout.tsx` (or a client-side effect in the landing view) with
  `navigator.serviceWorker.register('/sw.js')` gated by `process.env.NODE_ENV === 'production'`.
- See `ARCHITECTURE.md` §9.2 for the target `sw.js` shape.
- **Out of scope for this task** (would require `src/` changes).

**Status**: **Pending code**. Documented in `ARCHITECTURE.md` §9.2 + §13.

---

## Problem J — Incomplete offline / sync

**Symptom**: The editor autosaves via `PATCH /api/projects/[id]` every 5 s when online.
When offline, edits are lost on next reload (no IndexedDB persistence).

**Root cause**: No IndexedDB layer; no outbox queue; no service worker `sync` event
handler.

**Remediation approach**:
- Add `src/lib/offline.ts` with a thin IndexedDB wrapper exposing
  `putProject(doc)`, `getProject(id)`, `listOutbox()`, `pushOutbox(op)`,
  `clearOutbox(opId)`.
- Editor store writes-through to IndexedDB on every mutation (synchronous, non-blocking).
- Autosave debouncer checks `navigator.onLine`:
  - **Online** → `PATCH /api/projects/[id]` as today
  - **Offline** → push to outbox instead
- Service worker `sync` event drains the outbox in order, with conflict detection:
  server compares `updatedAt` against the request's `If-Match` header → 409 if stale.

**Status**: **Pending code**. Documented in `ARCHITECTURE.md` §9.3.

---

## Problem K — Incomplete media metadata

**Symptom**: `MediaAsset` rows are created with `duration`, `width`, `height`, `fps`,
`codec`, `audioChannels`, `thumbnailUrl`, `waveformUrl` all null/undefined. The
editor shows blank thumbnails and zero-duration clips until the user manually
specifies values.

**Root cause**: No FFprobe parsing runs after upload (Problem B); the upload handler
only writes the file and creates the row.

**Remediation approach**:
- Worker job `MEDIA_INGEST` runs `ffprobe -v error -print_format json -show_format
  -show_streams <asset>` and patches the row with `duration`, `width`, `height`, `fps`,
  `codec`, `audioChannels`.
- Thumbnail: `ffmpeg -ss <middle> -i <asset> -frames:v 1 -vf scale=480:-1 thumb.png`.
- Waveform: `ffmpeg -i <asset> -filter_complex "showwavespic=s=1280x120:colors=amber"
  wave.png`.
- Proxy: `ffmpeg -i <asset> -vf scale=854:-2 -c:v libx264 -preset fast -crf 28
  proxy.mp4` for smooth preview playback.
- All artifacts uploaded to object storage; `MediaAsset.{thumbnailUrl, waveformUrl}`
  patched with signed URLs.
- `MediaProcessor` interface in `media-engine` package exposes `ingest(assetId)`.

**Status**: **Architecture-ready**. Worker job type documented in `ARCHITECTURE.md`
§4.3 + §5. Requires FFmpeg binary (Problem B) + worker code.

---

## Problem L — Incomplete camera/screen capture

**Symptom**: The editor's "Record" affordance (in the Media panel) is UI-only — it
does not actually call `navigator.mediaDevices.getUserMedia()` or
`getDisplayMedia()`.

**Root cause**: Media capture requires user permission prompts + stream handling +
MediaRecorder to chunk the output into an uploadable Blob; this was deferred.

**Remediation approach**:
- Add `src/lib/capture.ts` with `startCameraCapture()` and `startScreenCapture()`
  wrappers around `getUserMedia({ video, audio })` and
  `getDisplayMedia({ video: true, audio: true })`.
- Wrap the stream in a `MediaRecorder` (preferring `video/webm;codecs=vp9,opus`); on
  `ondataavailable`, push chunks to an array; on `onstop`, assemble into a `Blob` and
  upload via the existing `POST /api/assets/upload` endpoint.
- UI in the media panel: a "Record" button opens a sheet with two tabs
  (Camera / Screen), a live preview, record/stop controls, and a "Save to project"
  button.
- **Out of scope for this task** (would require `src/` changes).

**Status**: **Pending code**. Documented in `ARCHITECTURE.md` §13.

---

## Problem M — AI commands not connected

**Symptom**: `POST /api/ai/edit` correctly returns structured `AICommand[]` (verified
end-to-end in Task ID 4-12 of the worklog). The editor's AI panel shows the response,
but the "Apply" / "Review" / "Cancel" buttons are visual-only — they do not actually
push the commands into the timeline.

**Root cause**: The `TimelineCommandEngine` (which translates AI commands into
reversible timeline mutations) was not implemented in the MVP UI; the AI panel was
built as a "preview what AI would do" surface only.

**Remediation approach**:
- Implement `TimelineCommandEngine.apply(commands: AICommand[])` in
  `src/lib/ai/timeline-command-engine.ts` that:
  - Maps each command type to a reversible operation (add_clip → push + undo-remove;
    apply_filter → patch + undo-revert; set_color → patch + undo-revert; etc.)
  - Pushes a single consolidated undo entry so `Cmd+Z` reverses the entire AI
    suggestion in one step.
  - Returns a `CommandResult` containing the affected clip IDs for highlight in the UI.
- Wire the AI panel's "Apply" button → `TimelineCommandEngine.apply(commands)` →
  `useEditorStore.getState().pushHistory(undoEntry)`.
- "Review" opens a modal showing the diff (clips added, modified, removed); "Cancel"
  discards.

**Status**: **Pending code**. The backend (`POST /api/ai/edit`) is implemented and
verified; the frontend command engine + button wiring is a follow-on task.

---

## Problem N — Hardcoded `/home/z/my-project` paths

**Symptom**: `src/app/api/assets/upload/route.ts` contains
`const UPLOAD_DIR = '/home/z/my-project/uploads'` — a host-specific absolute path
that will fail in any other environment.

**Root cause**: The path was convenient for the original sandbox and never
parameterized.

**Remediation approach**:
- `.env.example` declares `UPLOAD_DIR=./uploads`, `TEMP_DIR=./tmp`, `CACHE_DIR=./cache`
  as relative, deployable defaults.
- Upload route reads `process.env.UPLOAD_DIR ?? './uploads'` instead of hardcoding.
- `docker-compose.yml` mounts a named volume `uploads:/app/uploads` so uploads
  survive container restarts in local dev.
- `Dockerfile` sets `WORKDIR /app` and uses the env-relative paths.

> **Note**: This is a `src/` change which is out of scope for the docs-deploy-builder
> task. The **configs** (env var, docker volume, Dockerfile `WORKDIR`) are real and
> ready; the one-line source change in `upload/route.ts` is tracked as a follow-on.
> Until that source change ships, the sandbox still works because the hardcoded path
> happens to match the sandbox layout.

**Status**: **Fixed (configs) / Pending code (source)**. The new env vars + Docker
volume + Dockerfile `WORKDIR` are correct; the source needs a one-line refactor to
honor them.

---

## Problem O — `ignoreBuildErrors: true`

**Symptom**: `next.config.ts` contains:
```ts
typescript: { ignoreBuildErrors: true },
```
This causes Next.js to skip TypeScript type-checking at build time, allowing
type errors to slip into production builds silently.

**Root cause**: The flag was set during initial scaffolding to keep `bun run build`
fast while sibling views were still being constructed.

**Remediation approach**:
- The flag should be removed once all `src/` files type-check cleanly.
- As of the worklog, `bunx tsc --noEmit --skipLibCheck` still surfaces errors in
  unrelated locations (`examples/`, `skills/`, a duplicate-color issue in
  `src/lib/types.ts`). These are pre-existing and out of scope for this task.
- The flag is **intentionally left in place** for now — removing it would break
  `bun run build` for the sandbox. The `Dockerfile` and `render.yaml` build commands
  (`bun run build`) will succeed with the flag in place.
- A follow-on task (`types-cleanup`) should remove the flag + fix the remaining
  tsc errors.

**Status**: **Documented (intentional)**. The configs (`Dockerfile`, `render.yaml`,
`netlify.toml`) all run `bun run build` which succeeds today. Removing the flag is
a separate code-cleanup task.

---

## Migration strategy

### SQLite → PostgreSQL

1. Provision `vidiaforge-db` (Render Postgres 15) — declared in `render.yaml`.
2. Set `DATABASE_URL` to the Render connection string.
3. In `prisma/schema.prisma`, change `provider = "sqlite"` → `provider = "postgresql"`.
4. Run `bun run db:generate` to regenerate the Prisma client for Postgres.
5. Run `bunx prisma migrate dev --name init` to create the first real migration.
6. (Optional) Backfill existing SQLite data with `pg_loader` or a custom script — for
   the sandbox this is unnecessary (the dev DB has only test data).

**Risk**: low. The schema uses no SQLite-specific features. The only behavioral
difference: Postgres enforces column lengths on `String` (none declared here, so no
issue) and is strict about nullability (already declared correctly).

### Local FS → object storage

1. Provision an S3-compatible bucket (Cloudflare R2 recommended — no egress fees).
2. Set `STORAGE_PROVIDER=s3`, `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION`,
   `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_PUBLIC_BASE_URL`.
3. Implement `StorageProvider` adapters (out of scope for this task; see Problem F).
4. Upload route calls `storage.putObject(...)` instead of `fs.writeFile(...)`.
5. Asset GET endpoint returns a signed URL (302 redirect) instead of streaming from disk.
6. Existing `MediaAsset.storagePath` values (`"uploads/<uuid>.<ext>"`) need a one-time
   migration to the new key format (`"media/source/<userId>/<uuid>.<ext>"`) — but this
   only matters if you want to preserve existing assets; for a fresh deploy, the new
   format is used going forward.

**Risk**: medium. Requires `src/` changes to the upload + asset GET routes. The configs
are ready; the source change is the follow-on.

### Simulated render → FFmpeg worker

1. Provision `vidiaforge-redis` (Render Redis 7) — declared in `render.yaml`.
2. Provision the `vidiaforge-worker` service — declared in `render.yaml`.
3. Build the worker image with `worker.Dockerfile` (includes FFmpeg).
4. Implement the worker in `mini-services/worker/` (out of scope for this task).
5. Worker `BLPOP`s `queue:render` jobs and processes them as documented in
   `ARCHITECTURE.md` §6.
6. The browser-side export dialog already polls `GET /api/render/[id]` — no UI
   change required; just remove the simulated-progress code path.

**Risk**: medium. The hardest part is the FFmpeg filtergraph construction — the timeline
state has 17 transitions, 16 effects, 11 filters, 12 color controls, keyframes, masks,
and text overlays. A first cut can support a subset (cuts, fades, text, color) and
expand iteratively.

---

## Compatibility invariants

The migration **must** preserve:

- **UI/UX**: same landing page, same editor layout (top bar / left sidebar / center
  preview / right inspector / bottom timeline), same mobile editor, same keyboard
  shortcuts.
- **Timeline state**: `TimelineState` JSON schema (`schemaVersion: 1`) — see
  `src/lib/types.ts`. Any storage change must round-trip the same JSON.
- **Project schema**: Prisma `Project` model fields (`width`, `height`, `fps`,
  `canvasPreset`, `resolution`, `timelineData`, `duration`, `thumbnailUrl`,
  `favorite`, `lastSnapshot`, `lastSavedAt`) — unchanged.
- **Auth**: scrypt password hashing + httpOnly session cookie — unchanged. No
  user-visible auth change.
- **API contract**: all 16 endpoints keep their request/response shapes. The only
  behavioral change is that `POST /api/render` no longer relies on the client to
  fake progress — the worker drives it.
- **PWA manifest**: same name, same icons, same theme color — installability
  unchanged.
- **Editor autosave**: same debounce (5 s), same `PATCH /api/projects/[id]` endpoint,
  same `lastSavedAt` semantics — only the persistence path changes (Postgres + IndexedDB
  instead of just SQLite).

---

## Out-of-scope follow-on tasks

These are explicitly **not** addressed by this docs-deploy-builder task:

| Task | Required source change | Doc reference |
|---|---|---|
| Implement `StorageProvider` + S3 adapter | `src/lib/storage/*` + `src/app/api/assets/*` | Problem F |
| Implement `FFmpegRenderService` worker | `mini-services/worker/*` | Problem A |
| Implement `TranscriptionProvider` + worker job | `src/lib/ai/transcription/*` + `mini-services/worker/jobs/ai-transcribe.ts` | Problem D |
| Implement `TranslationProvider` + worker job | `src/lib/ai/translation/*` + `mini-services/worker/jobs/ai-translate.ts` | Problem E |
| Implement `MediaProcessor.ingest()` | `mini-services/worker/media-engine/*` | Problem K |
| Real camera/screen capture | `src/lib/capture.ts` + `src/components/editor/panels/media-panel.tsx` | Problem L |
| `TimelineCommandEngine.apply()` + AI panel wiring | `src/lib/ai/timeline-command-engine.ts` + `src/components/editor/panels/ai-panel.tsx` | Problem M |
| Real service worker + IndexedDB outbox | `public/sw.js` + `src/lib/offline.ts` + `src/app/layout.tsx` registration | Problems I, J |
| Replace hardcoded `UPLOAD_DIR` with env var | `src/app/api/assets/upload/route.ts` (one line) | Problem N |
| Remove `ignoreBuildErrors: true` | `next.config.ts` (after `tsc` is clean) | Problem O |

These are tracked in the worklog as future tasks.

---

End of `REMEDIATION.md`.
