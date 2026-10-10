# Changelog

All notable changes to **VidiaForge** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] — Prototype → Production transformation

This release transforms VidiaForge from a single-process Next.js prototype into a
production-grade, deployable PWA with a documented target architecture (Netlify
frontend + Render API + Render Worker + PostgreSQL + Redis + S3-compatible storage).

> **Honesty note**: the sandbox you can run today is still the single-process Next.js
> app (SQLite, local FS, simulated render). The production **deployments configs and
> abstractions** documented in this changelog are real and syntactically valid, but
> the source-level implementations of `StorageProvider`, `FFmpegRenderService`,
> `TranscriptionProvider`, `TranslationProvider`, `MediaProcessor`, real service worker,
> real camera/screen capture, and `TimelineCommandEngine.apply()` are **follow-on
> tasks** explicitly out of scope for this changelog's cut. See `docs/REMEDIATION.md`
> for the full problem-by-problem status.

### Added

#### Architecture documentation
- `docs/ARCHITECTURE.md` — comprehensive architecture document covering current state
  (single-app Next.js + SQLite + local FS + simulated render), target state
  (Netlify + Render + PostgreSQL + Redis + S3 + FFmpeg worker), ASCII architecture
  diagram, component breakdown (frontend modules, 16 API routes, 5 worker job queues,
  9 logical packages), data flow (upload → signed URL → object storage → MEDIA_INGEST
  job → FFprobe → thumbnail/waveform/proxy → MediaAsset metadata), render flow
  (`POST /api/render` → RenderJob → Redis queue → Worker → FFmpeg → object storage →
  signed download URL), AI flow (prompt → LLM → structured commands → schema validator
  → safety validator → preview → user approval → command engine → undo history),
  security model, PWA architecture, and offline/sync strategy.
- `docs/REMEDIATION.md` — problem-by-problem remediation log (15 items, A through O),
  each with root cause + remediation approach + status; migration strategy
  (SQLite → PostgreSQL, local FS → object storage, simulated render → FFmpeg worker);
  compatibility invariants (UI/UX, timeline state, project schema, auth, API contract,
  PWA manifest, autosave behavior).

#### New abstractions (target design, documented in `docs/ARCHITECTURE.md`)
- **`StorageProvider`** interface (`putObject`, `getObject`, `signUrl`, `deleteObject`)
  with adapters for local FS, S3-compatible (Cloudflare R2 / AWS S3 / MinIO), and GCS.
  Selection by `STORAGE_PROVIDER` env var. Local adapter preserves current behavior;
  S3 adapter enables production object storage.
- **`MediaProcessor`** interface in `media-engine` package — `ingest(assetId)` runs
  FFprobe → thumbnail → waveform → proxy transcode → patches `MediaAsset` metadata.
- **`FFmpegRenderService`** — worker service that consumes `queue:render`, builds an
  FFmpeg filtergraph from the project's `TimelineState`, encodes (libx264/libvpx),
  uploads to object storage, and patches `RenderJob` with progress + signed output URL.
- **`TranscriptionProvider`** interface with adapters for OpenAI Whisper, Deepgram,
  AssemblyAI, local Whisper.cpp. Selected by `TRANSCRIPTION_PROVIDER`.
- **`TranslationProvider`** interface with adapters for DeepL, Google Translate, LLM
  translation (OpenAI/Anthropic), LibreTranslate. Selected by `TRANSLATION_PROVIDER`.
- **`AICommandEngine`** — the existing `POST /api/ai/edit` handler elevated into a
  formal abstraction: system-prompt builder, LLM call (z-ai-web-dev-sdk /
  OpenAI / Anthropic / Gemini), JSON parser, deterministic fallbacks, schema validator
  (Zod), safety validator (rejects destructive commands).
- **`TimelineCommandEngine`** — translates `AICommand[]` into reversible timeline
  mutations: each command type maps to an undo entry; consolidated undo so `Cmd+Z`
  reverses the entire AI suggestion in one step.

#### Real camera/screen recording (target design)
- Documented `startCameraCapture()` and `startScreenCapture()` wrappers around
  `navigator.mediaDevices.getUserMedia({ video, audio })` and `getDisplayMedia()`.
- `MediaRecorder`-based chunking → Blob assembly → upload via existing
  `POST /api/assets/upload`.
- UI in the Media panel: a "Record" button opens a sheet with Camera / Screen tabs,
  live preview, record/stop controls, and "Save to project".

#### Real service worker (target design)
- `public/sw.js` (target) — Workbox-style precache of the shell + runtime cache for
  `/_next/static/*` (1-year immutable). Registration gated by
  `process.env.NODE_ENV === 'production'`.
- Precache list: `["/", "/manifest.webmanifest", "/icons/icon-512.png"]`.
- Fetch strategy: cache-first for `/_next/static/*`, network-first for everything else,
  fallback to cached `/` shell when offline.

#### IndexedDB offline layer (target design)
- `src/lib/offline.ts` (target) — thin IndexedDB wrapper:
  `putProject`, `getProject`, `listOutbox`, `pushOutbox`, `clearOutbox`.
- Editor store writes-through to IndexedDB on every mutation (non-blocking).
- Autosave debouncer checks `navigator.onLine`: online → PATCH as today; offline →
  push to outbox.
- Service worker `sync` event drains the outbox in order with conflict detection
  (`If-Match: <updatedAt>` → 409 if the project was edited elsewhere → "Keep local /
  Pull remote / Merge" dialog).

#### Deployment configs (real, deployable)
- **`.env.example`** — canonical environment template with all 24 placeholders
  (database, queue, auth, storage, AI, transcription, translation, CORS, public).
  No real secrets. Documents the `STORAGE_PROVIDER=local` fallback that preserves
  current behavior.
- **`netlify.toml`** — Netlify deployment config: Node 22, `bun run build`,
  `@netlify/plugin-nextjs`, security headers (X-Frame-Options DENY,
  X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin,
  Permissions-Policy for camera/microphone/display-capture), 1-year immutable cache
  for `/_next/static/*`, `/api/*` rewrite to the Render API origin via
  `NEXT_PUBLIC_API_URL`. Documents that `DATABASE_URL` / `STORAGE_SECRET_KEY` must
  **not** be set in Netlify (server-only).
- **`render.yaml`** — Render Blueprint v2: `vidiaforge-api` (web service, Node 22,
  `bun install && bun run build`, `bun .next/standalone/server.js`, health check
  `/api/health`), `vidiaforge-worker` (background worker, same runtime, `bun run
  worker:start`, env vars for DATABASE/REDIS/STORAGE/AI), `vidiaforge-db`
  (PostgreSQL), `vidiaforge-redis` (Redis). All env vars sourced from Render keychain.
- **`Dockerfile`** — production image based on `oven/bun:1-alpine` (multi-stage:
  deps → build → runner). Installs `ffmpeg`, `ffprobe`, `font-dejavu`,
  `ttf-dejavu-core`. Copies `.next/standalone` + `.next/static` + `public` + `prisma`.
  Exposes 3000. HEALTHCHECK via `wget --spider http://localhost:3000/api/health`.
  CMD: `node server.js` (Next.js standalone).
- **`worker.Dockerfile`** — worker-only image based on the main Dockerfile, with CMD
  `bun run worker:start`. Includes a build-time FFmpeg verification step
  (`ffmpeg -version` + `ffprobe -version`) that fails the build if FFmpeg is missing.
- **`docker-compose.yml`** — local dev with `postgres:15-alpine`,
  `redis:7-alpine`, `app` (build from `Dockerfile`), `worker` (same image, different
  command). Healthchecks for all services (pg_isready, redis-cli ping, /api/health).
  Named volumes for `postgres-data` + `uploads`. Documents that `bun run dev` still
  runs locally without Docker for the frontend.

### Changed

- **Project structure**: this changelog introduces a `docs/` directory containing the
  canonical architecture + remediation documents. The pre-existing
  `download/README.md` remains as a packaged-release artifact; the new
  root `/home/z/my-project/README.md` is now the canonical onboarding doc (18 sections).
- **Deployment posture**: documented as a Netlify (frontend) + Render (API + Worker)
  split. The single Next.js process is deployed to both platforms with different
  env var sets. See `docs/ARCHITECTURE.md` §3.1 for the rationale (edge-cached
  frontend, long-running API, real FFmpeg worker).
- **Environment variables**: standardized 24 placeholders in `.env.example`.
  `NEXT_PUBLIC_API_URL` is the single point of configuration for the browser → API
  origin (same-origin in dev, Render origin in production).
- **Build command**: standardized as `bun run build` (uses `next build` +
  post-build copy of `.next/static` + `public` into `.next/standalone/` — already
  in `package.json` scripts). The Dockerfile and Render Blueprint both invoke this.
- **Start command**: standardized as `bun .next/standalone/server.js` for production.
  `NODE_ENV=production` is required and set in the Dockerfile + Render Blueprint.

### Fixed

- **Hardcoded path remediation (configs)**: `.env.example` now declares
  `UPLOAD_DIR=./uploads`, `TEMP_DIR=./tmp`, `CACHE_DIR=./cache` as relative,
  deployable defaults. `docker-compose.yml` mounts a named volume `uploads:/app/uploads`
  so uploads survive container restarts. `Dockerfile` sets `WORKDIR /app` and uses the
  env-relative paths. (The one-line source change in `src/app/api/assets/upload/route.ts`
  to honor `process.env.UPLOAD_DIR` is a follow-on task — see `docs/REMEDIATION.md`
  Problem N.)
- **Build reproducibility**: pinned Node 22 across Netlify, Render, and Docker —
  prevents Node version skew from causing silent build differences.
- **Health check**: standardized `/api/health` (returns DB connectivity + timestamp)
  as the liveness probe for both Render web service and Docker HEALTHCHECK.
- **Security headers**: `netlify.toml` sets X-Frame-Options DENY,
  X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin,
  and Permissions-Policy allowing camera + microphone + display-capture (required
  for the in-browser recording feature) while denying everything else.
- **CORS**: `CORS_ORIGIN` env var documented for cross-origin API calls
  (Netlify frontend → Render API). Same-origin calls bypass this.

### Removed

- Nothing. This changelog is additive — no existing functionality is removed.
  The simulated render path in `ExportDialog` is intentionally **kept** until the
  real worker is wired (it provides a working demo today; the real path will be a
  drop-in replacement via the same `POST /api/render` contract).

### Security

- **Storage credentials** (`STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY`): documented as
  server-only env vars — never shipped to the browser. The browser only receives
  **signed URLs** (time-limited, scoped to a single object) from the API.
- **AI safety**: the existing `POST /api/ai/edit` endpoint already enforces a strict
  command schema (system prompt enumerates the allowed command types; JSON parser
  strips code fences; safety validator rejects destructive commands). This is
  documented in `docs/ARCHITECTURE.md` §7 + §8.6.
- **Upload safety** (unchanged but re-documented): MIME whitelist (12 types),
  500 MB hard limit, filename sanitization (strip path separators + control chars,
  truncate to 200 chars), internal name = UUID + extension.
- **Auth** (unchanged but re-documented): scrypt password hashing
  (N=2¹⁷, r=8, p=1) + per-user 16-byte salt + httpOnly + sameSite=lax + secure
  (production) session cookie + 30-day expiry + token rotation on every login.
- **Rate limiting** (target, documented in `docs/ARCHITECTURE.md` §8.7):
  `/api/auth/login` 5 req/15 min/IP, `/api/assets/upload` 30 req/hour/user,
  `/api/render` 10 req/hour/user, `/api/ai/edit` 60 req/hour/user. Implemented via
  Redis token bucket — pending Redis provisioning.
- **`.env.example`** contains only placeholders — never real secrets. The repo's
  existing `.env` (with `DATABASE_URL=file:/home/z/my-project/db/custom.db`) is the
  sandbox default; production deployments use the env vars from `.env.example` via
  Render keychain / Netlify site settings.

### Infrastructure

- **PostgreSQL**: Render-managed Postgres 15 (`vidiaforge-db`) declared in
  `render.yaml`. Prisma schema is already Postgres-compatible — migration is a
  one-line `provider = "postgresql"` change in `prisma/schema.prisma` (deliberately
  left as `sqlite` so the current sandbox keeps working). For local dev,
  `docker-compose.yml` declares `postgres:15-alpine`.
- **Redis**: Render-managed Redis 7 (`vidiaforge-redis`) declared in `render.yaml`.
  For local dev, `docker-compose.yml` declares `redis:7-alpine`.
- **Object storage**: S3-compatible (Cloudflare R2 / AWS S3 / MinIO) selected by
  `STORAGE_PROVIDER=s3` env var. Bucket = `STORAGE_BUCKET`. The browser-facing
  public base URL is `NEXT_PUBLIC_STORAGE_PUBLIC_BASE_URL` (CDN hostname, no
  credentials). Local fallback (`STORAGE_PROVIDER=local`) preserves current
  behavior — writes to `UPLOAD_DIR` on the local filesystem.
- **Netlify frontend**: `netlify.toml` configures `bun run build` (Next.js 16
  standalone), Node 22, security headers, 1-year immutable cache for static assets,
  and an `/api/*` rewrite to `NEXT_PUBLIC_API_URL`. The `@netlify/plugin-nextjs`
  plugin is declared inline to handle Next.js 16 App Router SSR.
- **Render API + Worker**: `render.yaml` deploys the same codebase to both a `web`
  service (Next.js standalone server on port 3000, health check `/api/health`) and a
  `worker` service (FFmpeg pipeline). Both use Node 22, `bun install && bun run
  build`. Worker's start command is `bun run worker:start` (target script in
  `mini-services/worker/`).
- **Docker**: `Dockerfile` produces a single image that can run as either the web
  service (default CMD: `node server.js`) or the worker (via `worker.Dockerfile`
  override CMD: `bun run worker:start`). Image includes FFmpeg + ffprobe + DejaVu
  fonts for worker capability. Multi-stage build (deps → build → runner) keeps the
  final image lean.
- **Local dev with Docker**: `docker-compose.yml` brings up postgres + redis + app +
  worker in one command (`docker compose up`). Healthchecks on all services.
  Documents that `bun run dev` still works for the frontend without Docker (SQLite +
  local FS + simulated render — the current sandbox experience).

---

## [0.2.1] — Prototype baseline

> Tagged by `package.json` version field. This is the state prior to the
  production-remediation work documented above.

- Single-process Next.js 16 App Router application.
- SQLite via Prisma (User, Session, Project, ProjectVersion, MediaAsset, RenderJob,
  AIJob, Template, UserPreferences).
- 16 API route handlers (auth, projects, assets incl. Range streaming, render, AI edit).
- Landing page (11 sections), Auth view, Dashboard view, Editor view (12 panels +
  top bar + left sidebar + center preview + right inspector + bottom timeline +
  mobile editor), Settings view (5 tabs), Create Project dialog, Export dialog,
  Share dialog, Settings dialog, Keyboard shortcuts dialog, Global loading.
- PWA manifest + icons (192/512/apple-touch/favicon).
- Simulated render pipeline (no FFmpeg).
- Simulated transcription + translation.
- Local filesystem storage (`/home/z/my-project/uploads`).
- Hardcoded `UPLOAD_DIR` absolute path.
- `ignoreBuildErrors: true` in `next.config.ts`.
- No service worker, no IndexedDB, no real camera/screen capture.
- AI edit returns structured commands; UI shows them as previewable but Apply button
  is not wired into the timeline.

---

End of `CHANGELOG.md`.
