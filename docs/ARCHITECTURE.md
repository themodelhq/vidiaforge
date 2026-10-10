# VidiaForge — Architecture

> Status: **Architecture document**. This file describes both the current sandbox state
> (what runs today) and the target production state (what the configs in this repo deploy to).
> Where the two diverge, the section is explicitly marked **[CURRENT]** vs **[TARGET]**.

---

## 1. Overview

VidiaForge is a professional, browser-based, AI-assisted video editing PWA. The editor runs
in the browser as a single-route Next.js 16 application; the heavy media work (ingest,
thumbnailing, transcoding, rendering) is delegated to a background worker that talks to
PostgreSQL, Redis, and S3-compatible object storage.

```
                              ┌──────────────────────────┐
                              │      VIDIAFORGE          │
                              │  (browser PWA client)    │
                              └────────────┬─────────────┘
                                           │ HTTPS (REST + Range)
                                           ▼
                          ┌────────────────────────────────┐
                          │  NETLIFY (frontend)  +        │
                          │  RENDER  (API + Worker)        │
                          │  Next.js 16 App Router         │
                          └────────────┬───────────────────┘
                                       │
            ┌──────────────────────────┼──────────────────────────┐
            │                          │                          │
            ▼                          ▼                          ▼
   ┌─────────────────┐       ┌──────────────────┐       ┌─────────────────────┐
   │  PostgreSQL    │       │     Redis        │       │  Object Storage     │
   │  (vidiaforge-db)│      │  (vidiaforge-    │       │  (S3-compatible:    │
   │  Users,         │       │   redis queue)   │       │   R2 / MinIO / S3)  │
   │  Projects,      │       │  MEDIA_INGEST,   │       │  source media,      │
   │  MediaAssets,   │       │  RENDER,         │       │  thumbnails,       │
   │  RenderJobs,    │       │  AI_*  queues    │       │  proxies, renders   │
   │  AIJobs         │       │                  │       │                     │
   └─────────────────┘       └────────┬─────────┘       └──────────┬──────────┘
                                      │                            │
                                      ▼                            │
                          ┌──────────────────────────┐            │
                          │  Background Worker        │            │
                          │  (Node 22 + FFmpeg)       │◄───────────┘
                          │  mini-services/worker     │
                          └──────────────────────────┘
```

---

## 2. Current State [CURRENT]

The sandbox you can run today is **a single-process Next.js 16 application**:

- **Framework**: Next.js 16 App Router + Turbopack, `output: "standalone"`
- **Routing**: a single `/` route; all views (landing / auth / dashboard / editor / settings)
  are switched via Zustand view-state in `src/stores/ui-store.ts`
- **Database**: Prisma + **SQLite** at `file:/home/z/my-project/db/custom.db`
  (the schema in `prisma/schema.prisma` is provider-agnostic and migrates to PostgreSQL
  with a one-line `provider = "postgresql"` change)
- **Media storage**: local filesystem at `/home/z/my-project/uploads/`,
  referenced by `MediaAsset.storagePath = "uploads/<uuid>.<ext>"`
- **Range streaming**: `GET /api/assets/[id]` implements HTTP `Range` / `206 Partial Content`
  so the editor can scrub large media files without buffering them whole
- **Render pipeline**: **simulated**. `POST /api/render` creates a `RenderJob` row with
  `status = "queued"`; the client patches progress via `PATCH /api/render/[id]`. No
  FFmpeg binary, no worker process, no real output file.
- **AI**: `z-ai-web-dev-sdk` (LLM) wired at `POST /api/ai/edit` — returns structured,
  previewable, reversible edit commands. Transcription, translation, and other AI kinds
  declared on `AIJob.kind` are **architecture-ready** but not implemented.
- **PWA**: `public/manifest.webmanifest` + icons (192/512/apple-touch/favicon). No service
  worker yet — the install prompt works but offline mode is partial (shell only via the
  browser's implicit cache, no explicit `sw.js`).
- **Camera/screen capture**: API surfaces and UI affordances exist in the editor; the
  `getDisplayMedia` / `getUserMedia` calls are stubbed. **Architecture-ready.**

### 2.1 What runs today

| Concern | Status |
|---|---|
| Landing page (11 sections) | ✅ Implemented |
| Auth (register/login/logout/me) | ✅ Implemented (scrypt + httpOnly cookie) |
| Dashboard (CRUD, search, favorites) | ✅ Implemented |
| Editor (12 panels, timeline, inspector) | ✅ Implemented |
| Mobile editor | ✅ Implemented |
| PWA manifest + icons | ✅ Implemented |
| Real service worker | ❌ Pending |
| Real FFmpeg render | ❌ Pending (simulated) |
| Real transcription / translation | ❌ Pending (simulated) |
| Object storage (S3/R2/MinIO) | ❌ Pending (local FS) |
| PostgreSQL | ❌ Pending (SQLite) |
| Redis queue | ❌ Pending (synchronous) |
| Real camera/screen recording | ❌ Pending (stubbed) |

---

## 3. Target State [TARGET]

The production deployment splits the application across **Netlify** (frontend) and
**Render** (API + Worker), backed by managed PostgreSQL, Redis, and S3-compatible
object storage. The deployment configs in this repo (`netlify.toml`, `render.yaml`,
`Dockerfile`, `docker-compose.yml`, `worker.Dockerfile`) are real, syntactically valid,
and target this architecture.

### 3.1 Component matrix

| Component | Hosts | Runtime | Source of truth |
|---|---|---|---|
| Frontend (Next.js SSR/SSG + SPA shell) | Netlify | Node 22 via `@netlify/plugin-nextjs` | This repo |
| API (Next.js Route Handlers — 16 endpoints) | Render web service `vidiaforge-api` | Node 22 + `bun .next/standalone/server.js` | This repo |
| Worker (FFmpeg + queue consumers) | Render background worker `vidiaforge-worker` | Node 22 + `bun run worker:start` | `mini-services/worker/*` (architecture-ready) |
| PostgreSQL | Render `vidiaforge-db` | Render Postgres 15 | Prisma schema |
| Redis | Render `vidiaforge-redis` | Render Redis 7 | Queue + ephemeral state |
| Object storage | Customer choice (Cloudflare R2 / AWS S3 / MinIO) | S3-compatible API | Bucket: `vidiaforge-media` |

> **Note on the single-app reality.** The current repo is one Next.js process that
> contains both the frontend UI and the API routes. The "split" between Netlify and Render
> is achieved by deploying the same codebase to both platforms with different
> environment variables. Netlify serves the static/SSR pages; Render serves the API
> routes (and the worker runs alongside as a separate Render service with the same image
> but a different start command).

### 3.2 Why split at all?

1. **Edge-cached frontend** — Netlify's global CDN serves the Next.js App Router pages
   close to users; static assets in `/_next/static/*` are cached for 1 year.
2. **Long-running API + Worker** — Render keeps the Next.js standalone server warm
   (no cold-start edge function limits) and the worker process running indefinitely.
3. **Real media processing** — the worker needs `ffmpeg`, `ffprobe`, and fonts installed
   at the OS level; that's not viable on Netlify Functions (50ms–10s execution limit).
4. **Managed Postgres + Redis** — Render's managed instances handle backups, failover,
   and connection pooling without us running them ourselves.

---

## 4. Component Breakdown

### 4.1 Frontend modules (in `src/`)

| Module | Path | Responsibility |
|---|---|---|
| Landing view | `src/components/views/landing-view.tsx` | Marketing page, hero, features bento, AI tools, templates, pricing, FAQ, footer |
| Auth view | `src/components/views/auth-view.tsx` | Login + register forms (zod-validated) |
| Dashboard view | `src/components/views/dashboard-view.tsx` | Project grid/list, search, favorites, create/duplicate/rename/delete |
| Editor view | `src/components/views/editor-view.tsx` | Editor shell, keyboard shortcuts, playback loop |
| Settings view | `src/components/views/settings-view.tsx` | Account/appearance/notifications/billing/security |
| Global loading | `src/components/views/global-loading.tsx` | Top-of-page loading indicator |
| Editor top bar | `src/components/editor/editor-top-bar.tsx` | Project name, undo/redo, save status, AI/Share/Export buttons |
| Left sidebar | `src/components/editor/left-sidebar.tsx` | 12-tab panel switcher |
| Center preview | `src/components/editor/center-preview.tsx` | Video canvas, clip stacking, transport, timecode |
| Right inspector | `src/components/editor/right-inspector.tsx` | Transform/Crop/Color/Speed/Audio/Text/Effects/Keyframes |
| Bottom timeline | `src/components/editor/bottom-timeline.tsx` | Multi-track clips, playhead, ruler, markers, zoom |
| Mobile editor | `src/components/editor/editor-mobile-view.tsx` | Touch UI: horizontal timeline + tool tray sheet |
| 12 editor panels | `src/components/editor/panels/*.tsx` | Media/Audio/Text/Captions/Stickers/Effects/Filters/Transitions/Templates/AI/BrandKit/Elements |
| Export dialog | `src/components/editor/export-dialog.tsx` | Format/resolution/fps/bitrate + render queue |
| Share dialog | `src/components/editor/share-dialog.tsx` | Permissions + share link + revoke |
| Settings dialog | `src/components/editor/settings-dialog.tsx` | Project/editor/shortcuts/storage tabs |
| Keyboard shortcuts | `src/components/editor/keyboard-shortcuts-dialog.tsx` | 5-group shortcut cheat sheet |

### 4.2 API routes (16 handlers in `src/app/api/`)

| Route | Method(s) | Purpose |
|---|---|---|
| `/api/health` | GET | Liveness + DB connectivity check |
| `/api/auth/register` | POST | Create user + seed session + preferences |
| `/api/auth/login` | POST | Verify scrypt hash, issue session |
| `/api/auth/logout` | POST | Revoke session |
| `/api/auth/me` | GET | Current user from session cookie |
| `/api/projects` | GET, POST | List / create projects |
| `/api/projects/[id]` | GET, PATCH, DELETE | Read / update / delete a project |
| `/api/projects/[id]/duplicate` | POST | Clone a project (with assets in target storage) |
| `/api/projects/[id]/versions` | GET, POST | Project snapshots / undo history |
| `/api/assets` | GET | List user media assets |
| `/api/assets/upload` | POST | Multipart upload (500 MB cap, MIME whitelist) |
| `/api/assets/[id]` | GET, DELETE | Range-stream / delete asset |
| `/api/render` | GET, POST | List / enqueue render jobs |
| `/api/render/[id]` | GET, PATCH | Read / update render job status |
| `/api/render/[id]/cancel` | POST | Cancel queued/processing job |
| `/api/ai/edit` | POST | LLM → structured, previewable edit commands |

### 4.3 Worker jobs (target — `mini-services/worker/`)

| Job queue | Trigger | Steps |
|---|---|---|
| `MEDIA_INGEST` | `POST /api/assets/upload` after object-storage write | FFprobe → thumbnail (poster frame) → waveform PNG → transcode proxy (480p H.264) → patch `MediaAsset.{duration,width,height,fps,codec,thumbnailUrl,waveformUrl}` |
| `RENDER` | `POST /api/render` enqueues | Resolve project timeline → for each clip, fetch source from object storage → FFmpeg compositing pipeline (effects, filters, transitions, captions burn-in, text overlays, keyframes, color grading, speed) → encode (libx264/libvpx) → upload output → signed download URL → patch `RenderJob.{status,outputUrl,progress,completedAt}` |
| `AI_TRANSCRIBE` | `POST /api/ai/transcribe` (target) | Resolve audio → call TranscriptionProvider (Deepgram/OpenAI Whisper/local) → produce `CaptionCue[]` → patch `AIJob.output` |
| `AI_TRANSLATE` | `POST /api/ai/translate` (target) | Resolve captions → call TranslationProvider → produce translated `CaptionCue[]` |
| `AI_HIGHLIGHTS` | `POST /api/ai/highlights` (target) | Resolve audio → silence detection + scene detection → mark candidate ranges → produce previewable edit commands |

### 4.4 Packages (target monorepo layout)

> The current sandbox is a single Next.js app; the package boundaries below are
> **logical** — enforced by import discipline rather than npm workspaces. Production
> extraction into a real monorepo is a follow-on task.

| Package | Responsibility | Currently lives at |
|---|---|---|
| `editor-core` | Editor shell, view routing, keyboard manager, plugin registry | `src/components/views/editor-view.tsx` + `src/stores/*` |
| `timeline-engine` | Non-destructive timeline state, track/clip model, snapping, magnetic timeline, ripple edits | `src/lib/timeline.ts` + `src/lib/types.ts` + `src/stores/editor-store.ts` |
| `media-engine` | Media ingestion, FFprobe parsing, thumbnail/waveform/proxy generation, `StorageProvider` abstraction | (target) `mini-services/worker/media-engine/*` |
| `render-engine` | FFmpeg compositing pipeline, codec/format selection, render queue consumer | (target) `mini-services/worker/render-engine/*` |
| `ai-engine` | `AICommandEngine` + `TranscriptionProvider` + `TranslationProvider` + `TimelineCommandEngine` + safety validator | (target) `src/lib/ai/*` (currently only `POST /api/ai/edit` is wired via `z-ai-web-dev-sdk`) |
| `audio-engine` | Volume/pan/fade/ducking, AI voiceover, music library, SFX | (target) `src/lib/audio/*` (UI exists in `panels/audio-panel.tsx`) |
| `project-schema` | Zod schemas for `ProjectDocument`, `TimelineState`, `MediaAssetDTO`, `RenderJobDTO`, AI command schema | `src/lib/types.ts` (types only today; Zod runtime validation is target) |
| `shared` | Shared utils, env loader, error types, signed-URL helpers | `src/lib/utils.ts`, `src/lib/auth.ts`, `src/lib/db.ts` |
| `ui` | shadcn/ui component library (New York variant) | `src/components/ui/*` |

---

## 5. Data Flow: Upload → MediaAsset

```
[Browser] POST /api/assets/upload (multipart/form-data, file + projectId)
   │
   ▼
[API] getSessionUser() → 401 if missing
   │
   ▼
[API] MIME whitelist + 500 MB cap → 415/413 if rejected
   │
   ▼
[API] Verify project ownership (if projectId) → 403 if mismatch
   │
   ▼
[API] Generate internalName = `${uuid}.${ext}`
   │
   ▼
[CURRENT] fs.writeFile(uploads/<internalName>, buffer)
[TARGET] StorageProvider.putObject(`media/source/<userId>/<internalName>`,
                                   stream, contentType)
   │
   ▼
[API] db.mediaAsset.create({ ..., storagePath: "media/source/<userId>/<internalName>" })
   │
   ▼
[TARGET] Queue MEDIA_INGEST job with assetId
   │
   ▼
[Worker] FFprobe(asset) → { duration, width, height, fps, codec, audioChannels }
   │
   ▼
[Worker] ffmpeg -ss <middle> -i <asset> -frames:v 1 thumbnail.png
         → StorageProvider.putObject("media/thumb/<assetId>.png")
   │
   ▼
[Worker] ffmpeg -i <asset> -filter_complex "showwavespic=s=1280x120" waveform.png
         → StorageProvider.putObject("media/wave/<assetId>.png")
   │
   ▼
[Worker] ffmpeg -i <asset> -vf scale=854:-2 -c:v libx264 -preset fast proxy.mp4
         → StorageProvider.putObject("media/proxy/<assetId>.mp4")
   │
   ▼
[Worker] db.mediaAsset.update({ where: { id }, data: { duration, width, height, fps,
         codec, audioChannels, thumbnailUrl, waveformUrl }})
```

**Signed URLs**: in target state, `MediaAsset.thumbnailUrl` etc. are not raw object keys —
they are time-limited signed GET URLs (default TTL 1 hour) issued by `StorageProvider.signUrl()`.
The browser never sees raw credentials; only signed URLs are returned in JSON responses.

---

## 6. Render Flow: POST /api/render → Signed Download URL

```
[Browser] POST /api/render { projectId, format, codec, resolution, fps, bitrate }
   │
   ▼
[API] getSessionUser() → load project → verify ownership
   │
   ▼
[API] db.renderJob.create({ status: "queued", ... })
   │
   ▼
[CURRENT] Client polls PATCH /api/render/[id] with simulated progress
[TARGET]  Redis RPUSH "queue:render" { jobId }
   │
   ▼
[Worker] BLPOP "queue:render" → fetch RenderJob + Project.timelineData
   │
   ▼
[Worker] Resolve all assetIds → signed GET URLs for source media
   │
   ▼
[Worker] Build FFmpeg filtergraph:
           - per-clip scale/crop/overlay (transform, crop)
           - colorAdjust (eq filter)
           - effects (avgblur, vignette, boxblur, etc.)
           - filters (curves LUTs)
           - text overlays (drawtext with DejaVu fonts)
           - caption burn-in (subtitles= filter from SRT)
           - transitions (xfade)
           - keyframes (between= expressions)
   │
   ▼
[Worker] ffmpeg -filter_complex "<graph>" \
           -map "[out_v]" -map "[out_a]" \
           -c:v libx264 -preset medium -crf 23 \
           -c:a aac -b:a 192k \
           -movflags +faststart \
           -f mp4 output.mp4
   │
   ▼
[Worker] Stream progress: parse ffmpeg stderr → PATCH /api/render/[id]
         { status: "processing", progress: 0.0..1.0, stage: "encoding|muxing|uploading" }
   │
   ▼
[Worker] StorageProvider.putObject("renders/<jobId>.mp4", stream, "video/mp4")
   │
   ▼
[Worker] signedUrl = StorageProvider.signUrl("renders/<jobId>.mp4", ttl=24h)
   │
   ▼
[Worker] db.renderJob.update({ status: "completed", outputUrl: signedUrl,
         progress: 1, completedAt: new Date() })
   │
   ▼
[Browser] Polls GET /api/render/[id] → receives signedUrl → triggers download
```

**Cancellation**: `POST /api/render/[id]/cancel` sets `status = "cancelled"` and
`RPUSH "queue:render-cancel" { jobId }`; the worker's poll loop checks both queues
and `SIGKILL` the ffmpeg process if a cancel request arrives mid-render.

---

## 7. AI Flow: Prompt → Edit Commands → Preview → Apply

```
[Browser] User types: "Make this more cinematic"
   │
   ▼
[API] POST /api/ai/edit { prompt, projectId, context: timelineSnapshot }
   │
   ▼
[AICommandEngine]
   - Build system prompt enumerating the command schema (add_clip, add_text,
     apply_filter, apply_effect, add_transition, set_color, set_speed,
     remove_silence, reframe, cut_to_beat, etc.)
   - Call z-ai-web-dev-sdk (or OPENAI / ANTHROPIC / GEMINI based on AI_PROVIDER)
   - Parse JSON response (strip ```json fences, slice to outermost {...})
   - Deterministic fallbacks for common prompts (cinematic, caption, silence,
     short, speed) when the LLM fails or returns non-JSON
   │
   ▼
[Schema Validator] Zod-verify each command against the AICommandSchema
   - Reject unknown command types
   - Reject out-of-range parameters (e.g. speed > 8, opacity < 0)
   │
   ▼
[Safety Validator] Reject destructive commands:
   - No "delete_all_clips" without explicit confirmation token
   - No clip manipulation outside the project scope
   - No asset fetching beyond what's already in the project
   │
   ▼
[API] Returns { commands: AICommand[], previewable: true, reversible: true }
   │
   ▼
[Browser] Renders a preview diff (overlay on the timeline showing what would change)
   - "Apply" button → TimelineCommandEngine.apply(commands) → undo history push
   - "Cancel" → discard, no state mutation
   │
   ▼
[TimelineCommandEngine]
   - Each command maps to a reversible operation:
       add_clip    → push clip, undo = remove clip
       apply_filter → patch clip.filters, undo = revert filter array
       set_color    → patch clip.color, undo = revert color object
       add_text     → push text clip, undo = remove
       add_transition → patch clip.transitions, undo = revert
       set_speed    → patch clip.speed + recalc duration, undo = revert
       remove_silence → splice clips, undo = restore original clips
       reframe      → patch transform + crop, undo = revert
   - All commands push to a single undo entry so "Cmd+Z" reverses the entire
     AI suggestion in one step
   - State is persisted via existing autosave (PATCH /api/projects/[id])
```

**Key invariant**: AI **never** destroys user work. Every command is reversible. The
safety validator rejects any command that would mutate state outside the project
scope (e.g. deleting other users' assets, fetching external URLs).

---

## 8. Security Model

### 8.1 Authentication

- **Password hashing**: Node `scrypt` (N=2¹⁷, r=8, p=1) with per-user 16-byte salt
- **Session**: random 32-byte token stored in `Session` table with `expiresAt`
- **Cookie**: `vidiaforge_session`, `httpOnly: true`, `sameSite: 'lax'`,
  `secure: true` in production (NODE_ENV=production), `path: '/'`, `maxAge: 30d`
- **Rotation**: every login rotates the session token (old row deleted)

### 8.2 Authorization (per-route)

Every protected route calls `getSessionUser()` from `src/lib/auth.ts`. Project/asset/render
routes verify ownership:

```ts
if (record.userId !== user.id) return 403 Forbidden
```

### 8.3 Transport

- **Frontend (Netlify)**: HTTPS enforced by default; HSTS via Netlify's automatic TLS
- **API (Render)**: HTTPS by default; HSTS header set in `next.config.ts` (target addition)
- **CORS**: configured via `CORS_ORIGIN` env var — only the listed origin(s) may call
  the API cross-origin (same-origin calls bypass this)

### 8.4 Upload safety

- **MIME whitelist** (12 types): `video/{mp4,quicktime,webm}`, `audio/{mpeg,wav,aac,m4a,ogg}`,
  `image/{jpeg,png,webp,gif}`
- **Size cap**: 500 MB hard limit (rejected with 413 before any disk write)
- **Filename sanitization**: strip path separators + control chars, truncate to 200 chars
- **Internal name**: random UUID + correct extension — user's original filename is
  stored in `MediaAsset.filename` for display only, never used as a path component

### 8.5 Storage credentials

- **Never** shipped to the browser. The browser only receives **signed URLs**
  (time-limited, scoped to a single object).
- **`STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY`** are server-only env vars; the only
  `NEXT_PUBLIC_*` storage var is `NEXT_PUBLIC_STORAGE_PUBLIC_BASE_URL` (a CDN hostname,
  no credentials).

### 8.6 AI safety

- The system prompt explicitly enumerates the command schema — the LLM cannot invent
  commands outside the schema.
- The schema validator + safety validator reject anything out-of-band.
- AI commands are **always** previewable + reversible — see §7.

### 8.7 Rate limiting (target)

- `/api/auth/login`: 5 req / 15 min / IP
- `/api/assets/upload`: 30 req / hour / user
- `/api/render`: 10 req / hour / user
- `/api/ai/edit`: 60 req / hour / user
- Implemented via Redis token bucket (target); in the current sandbox, no rate limit.

---

## 9. PWA Architecture

### 9.1 Manifest

`public/manifest.webmanifest` declares:
- `name: "VidiaForge"`
- `short_name: "VidiaForge"`
- `display: "standalone"`
- `theme_color: "#0a0a0a"` (matches `--background` token)
- `background_color: "#0a0a0a"`
- `icons`: 192, 512 (PNG + SVG maskable)

### 9.2 Service worker [TARGET]

> **Current state**: no `sw.js` registered. The browser's implicit cache handles
> static assets but there is **no offline shell, no IndexedDB sync, no background
> fetch**. This is documented honestly in `REMEDIATION.md` Problem J.

Target `public/sw.js` (Precache + IndexedDB sync):

```js
// pseudo — real file to be added in a follow-on task
const CACHE = 'vidiaforge-v1'
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-512.png']

install  → precache SHELL
activate → delete old caches
fetch    → cache-first for /_next/static/*, network-first for everything else,
           fallback to cached "/" shell when offline
sync     → flush pending autosaves from IndexedDB → POST /api/projects/[id]
```

### 9.3 Offline / sync strategy

- **Project state** → IndexedDB store `vidiaforge:projects` keyed by `projectId`
- **Autosave** → write-through: every timeline mutation goes to Zustand + IndexedDB
  synchronously, then debounced (5 s) PATCH to `/api/projects/[id]`
- **Offline detection** → `navigator.onLine` + `online` / `offline` events
- **Replay queue** → IndexedDB store `vidiaforge:outbox` holds pending PATCH bodies;
  the service worker `sync` event flushes them in order with conflict detection
  (server compares `updatedAt` and returns 409 if the project was edited elsewhere)
- **Conflict resolution** → on 409, the client shows a "Project was edited elsewhere.
  Keep local / Pull remote / Merge" dialog (target UI; current sandbox keeps local-only)

---

## 10. Observability

| Signal | Source | Destination (target) |
|---|---|---|
| HTTP request logs | Next.js server | stdout (Render captures) → Log drain |
| Render job events | Worker `console.log` | stdout → Render log drain |
| FFmpeg stderr | Worker subprocess | parsed for progress; full stderr captured at DEBUG |
| Health check | `/api/health` | Render probes every 30 s |
| Metrics | `/api/health` extension (target) | Render metrics dashboard |
| Errors | `try/catch` in route handlers → 500 with sanitized error message | Render log drain |

---

## 11. Environment Variables

See `.env.example` for the canonical list. Summary:

- **Database**: `DATABASE_URL`
- **Queue**: `REDIS_URL`
- **Auth**: `JWT_SECRET`, `SESSION_SECRET`
- **Storage**: `STORAGE_PROVIDER`, `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION`,
  `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_PUBLIC_BASE_URL`
- **Local fallback**: `UPLOAD_DIR`, `TEMP_DIR`, `CACHE_DIR`
- **AI**: `AI_PROVIDER`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`
- **Transcription/Translation**: `TRANSCRIPTION_PROVIDER`/`_API_KEY`,
  `TRANSLATION_PROVIDER`/`_API_KEY`
- **CORS**: `CORS_ORIGIN`
- **Public (browser-safe)**: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_NAME`,
  `NEXT_PUBLIC_STORAGE_PUBLIC_BASE_URL`

---

## 12. File Index (deliverables in this repo)

| File | Purpose |
|---|---|
| `docs/ARCHITECTURE.md` | This document |
| `docs/REMEDIATION.md` | Problem-by-problem remediation log (15 items, A–O) |
| `CHANGELOG.md` | Transformation changelog |
| `.env.example` | Canonical environment template (no real secrets) |
| `netlify.toml` | Netlify deployment config (frontend) |
| `render.yaml` | Render Blueprint v2 (API + Worker + Postgres + Redis) |
| `Dockerfile` | Production image (Next.js standalone + FFmpeg) |
| `docker-compose.yml` | Local dev with postgres + redis + app + worker |
| `worker.Dockerfile` | Worker-only image (same base, `bun run worker:start`) |
| `README.md` | Comprehensive onboarding doc (18 sections) |

---

## 13. Honest Status Table

| Capability | Sandbox today | Production target | Configs exist? |
|---|---|---|---|
| Landing + auth + dashboard + editor | ✅ Works | ✅ | n/a |
| Single-route SPA view switching | ✅ Works | ✅ | n/a |
| Prisma schema (User/Project/MediaAsset/RenderJob/AIJob/Template/UserPreferences) | ✅ SQLite | PostgreSQL | `prisma/schema.prisma` + `render.yaml` |
| Range-streamed asset playback | ✅ Works | ✅ | n/a |
| Real FFmpeg render pipeline | ❌ Simulated | ✅ | `render.yaml`, `Dockerfile`, `worker.Dockerfile` |
| Real transcription / translation | ❌ Stubbed | ✅ | `.env.example` |
| Object storage (S3-compatible) | ❌ Local FS | ✅ | `.env.example`, `Dockerfile` |
| Redis-backed render queue | ❌ Synchronous | ✅ | `render.yaml`, `docker-compose.yml` |
| Netlify frontend deployment | ❌ Not deployed | ✅ | `netlify.toml` |
| Render API + Worker deployment | ❌ Not deployed | ✅ | `render.yaml` |
| Real service worker (offline shell) | ❌ No `sw.js` | ✅ | Documented in `REMEDIATION.md` |
| Real camera/screen capture (`getUserMedia`/`getDisplayMedia`) | ❌ Stubbed | ✅ | Documented in `REMEDIATION.md` |
| AI edit commands (preview + reverse) | ✅ Works (z-ai-web-dev-sdk) | ✅ | n/a |

---

End of `ARCHITECTURE.md`.
