# VidiaForge

> A professional, browser-based, AI-powered video editing PWA.
> Built with Next.js 16, TypeScript, Tailwind CSS 4, shadcn/ui, Prisma, Zustand,
> framer-motion, and the z-ai-web-dev-sdk.

VidiaForge combines the usability of CapCut with the workflow depth of Adobe
Premiere Pro — runs entirely in the browser, installable as a PWA, and designed
for a production deployment split across Netlify (frontend), Render (API + worker),
PostgreSQL, Redis, and S3-compatible object storage.

> **Honest status**: the sandbox you can run today is a single-process Next.js 16
> app (SQLite + local FS + simulated render). The production deployment configs
> in this repo (`netlify.toml`, `render.yaml`, `Dockerfile`, `docker-compose.yml`,
> `worker.Dockerfile`, `.env.example`) are real and deployable; the worker source
> (`mini-services/worker/`), `StorageProvider` adapter, real service worker,
> IndexedDB outbox, and `TimelineCommandEngine.apply()` are documented in
> `docs/REMEDIATION.md` as follow-on code tasks.

---

## Table of Contents

1. [Architecture](#1-architecture)
2. [Prerequisites](#2-prerequisites)
3. [Local setup](#3-local-setup)
4. [PostgreSQL](#4-postgresql)
5. [Redis](#5-redis)
6. [Object storage](#6-object-storage)
7. [AI providers](#7-ai-providers)
8. [Environment variables](#8-environment-variables)
9. [Development](#9-development)
10. [Testing](#10-testing)
11. [Production build](#11-production-build)
12. [Netlify deployment](#12-netlify-deployment)
13. [Render deployment](#13-render-deployment)
14. [Worker deployment](#14-worker-deployment)
15. [Troubleshooting](#15-troubleshooting)
16. [Media engine architecture](#16-media-engine-architecture)
17. [Project schema](#17-project-schema)
18. [Rendering architecture](#18-rendering-architecture)

---

## 1. Architecture

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
   │  Users,        │       │  RENDER +        │       │  (S3-compatible:    │
   │  Projects,     │       │  AI_*  queues    │       │   R2 / MinIO / S3)  │
   │  MediaAssets,   │       │                  │       │  source media,      │
   │  RenderJobs,    │       │                  │       │  thumbnails,        │
   │  AIJobs         │       │                  │       │  proxies, renders   │
   └─────────────────┘       └────────┬─────────┘       └──────────┬──────────┘
                                      │                            │
                                      ▼                            │
                          ┌──────────────────────────┐            │
                          │  Background Worker        │            │
                          │  (Node 22 + FFmpeg)       │◄───────────┘
                          │  mini-services/worker     │
                          └──────────────────────────┘
```

See `docs/ARCHITECTURE.md` for the full document covering component breakdown,
data flow, render flow, AI flow, security model, PWA architecture, and the
honest status table of what works today vs. what requires real infra.

---

## 2. Prerequisites

| Tool | Version | Why |
|---|---|---|
| **Node.js** | 22.x | Pinned across Netlify, Render, and Docker — prevents version skew |
| **Bun** | 1.x | Runtime + package manager (faster than npm/yarn, smaller images) |
| **PostgreSQL** | 15+ | Production database (Render-managed or local via `docker compose`) |
| **Redis** | 7+ | Render queue + rate-limit + ephemeral state |
| **FFmpeg + ffprobe** | 6.x+ | Required by the render worker (`apk add ffmpeg ffprobe` on Alpine) |
| **S3-compatible storage** | any | Cloudflare R2 / AWS S3 / MinIO / Wasabi / B2 |
| **Git** | 2.x | Version control |

For local dev without Docker, you only need Bun installed — the sandbox defaults
to SQLite + local FS + simulated render, so you can run the editor end-to-end
without provisioning PostgreSQL, Redis, FFmpeg, or S3.

---

## 3. Local setup

### 3.1 Sandbox mode (fastest, no infra)

```bash
# 1. Install dependencies
bun install

# 2. Create the SQLite database (already configured via .env)
bun run db:push

# 3. Start the dev server
bun run dev
# → http://localhost:3000
```

This runs:
- Next.js 16 + Turbopack dev server on port 3000
- Prisma + SQLite at `db/custom.db`
- Local file uploads to `uploads/`
- Simulated render pipeline (no FFmpeg needed)

### 3.2 Full-stack mode (Docker Compose)

```bash
# 1. Copy the env template + edit secrets
cp .env.example .env
# Generate JWT_SECRET + SESSION_SECRET:
for k in JWT_SECRET SESSION_SECRET; do
  echo "$k=$(openssl rand -hex 32)" >> .env
done

# 2. Start the full stack (postgres + redis + app + worker)
docker compose up -d

# 3. Tail logs (optional)
docker compose logs -f app

# 4. Apply Prisma migrations to the Postgres container
docker compose exec app bunx prisma migrate deploy
# (After switching prisma/schema.prisma provider to "postgresql".)
```

The app is available at `http://localhost:3000`, Postgres on `:5432`, Redis on `:6379`.

### 3.3 Hybrid mode (dev server + Dockerized infra)

If you want fast Next.js HMR but real Postgres + Redis:

```bash
# 1. Start only postgres + redis
docker compose up -d postgres redis

# 2. Point .env at the host-exposed ports
echo 'DATABASE_URL=postgresql://vidiaforge:vidiaforge_dev_password@localhost:5432/vidiaforge?schema=public' >> .env
echo 'REDIS_URL=redis://localhost:6379' >> .env

# 3. Switch Prisma to Postgres (one line)
sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma
bun run db:generate
bunx prisma migrate dev --name init

# 4. Run the dev server (hot reload)
bun run dev
```

---

## 4. PostgreSQL

### 4.1 Why PostgreSQL over SQLite

| Concern | SQLite | PostgreSQL |
|---|---|---|
| Concurrent writes | Single writer | MVCC, high concurrency |
| JSON operations | Limited | Native JSONB + indexes |
| Row-level security | No | Yes |
| Replication / failover | Manual | Built-in |
| Render managed | No | Yes |

The Prisma schema in `prisma/schema.prisma` is **already Postgres-compatible** —
no SQLite-specific pragmas. Migration is a one-line change.

### 4.2 Switching to PostgreSQL

1. Edit `prisma/schema.prisma`:
   ```diff
   - provider = "sqlite"
   + provider = "postgresql"
   ```
2. Regenerate the client: `bun run db:generate`
3. Create the first migration: `bunx prisma migrate dev --name init`
4. (Production) Apply migrations on deploy: `bunx prisma migrate deploy`

### 4.3 Managed Postgres on Render

Declared in `render.yaml`:

```yaml
databases:
  - name: vidiaforge-db
    plan: starter
    region: oregon
    ipAllowList:
      - source: 0.0.0.0/0
        description: Allow Render services (internal network)
```

Render injects the connection string into the `app` and `worker` services via:

```yaml
envVars:
  - key: DATABASE_URL
    fromDatabase:
      name: vidiaforge-db
      property: connectionString
```

### 4.4 Local Postgres via Docker Compose

```yaml
postgres:
  image: postgres:15-alpine
  environment:
    POSTGRES_USER: vidiaforge
    POSTGRES_PASSWORD: vidiaforge_dev_password
    POSTGRES_DB: vidiaforge
  ports: ["5432:5432"]
  volumes: [postgres-data:/var/lib/postgresql/data]
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U vidiaforge -d vidiaforge"]
```

---

## 5. Redis

### 5.1 What Redis is used for

| Use case | Key prefix | TTL |
|---|---|---|
| Render queue | `queue:render` | persistent (BLPOP) |
| Media-ingest queue | `queue:media-ingest` | persistent |
| AI transcription queue | `queue:ai-transcribe` | persistent |
| AI translation queue | `queue:ai-translate` | persistent |
| Render cancel signal | `queue:render-cancel` | persistent |
| Rate-limit tokens | `ratelimit:<route>:<id>` | 15 min — 1 hour |
| Signed-URL cache | `signedurl:<key>` | matches signed TTL |
| Session cache (optional) | `session:<token>` | matches cookie maxAge |

### 5.2 Managed Redis on Render

```yaml
databases:
  - name: vidiaforge-redis
    plan: starter
    region: oregon
```

Injected into services via:

```yaml
envVars:
  - key: REDIS_URL
    fromDatabase:
      name: vidiaforge-redis
      property: connectionString
```

### 5.3 Local Redis via Docker Compose

```yaml
redis:
  image: redis:7-alpine
  command: redis-server --save 60 1 --loglevel warning
  ports: ["6379:6379"]
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
```

---

## 6. Object storage

### 6.1 Why object storage, not local FS

- **Scalability**: object storage handles petabytes; local FS fills up the disk.
- **CDN**: S3-compatible providers offer edge caching via `STORAGE_PUBLIC_BASE_URL`.
- **Durability**: 11 nines typical; local FS has no replication.
- **Worker access**: the worker (running on a separate instance) cannot read the
  app's local FS — both must share an object store.
- **Signed URLs**: object storage can issue time-limited signed URLs so the browser
  never sees credentials.

### 6.2 The `StorageProvider` abstraction

```ts
interface StorageProvider {
  putObject(key: string, body: Buffer | ReadableStream, contentType: string): Promise<{ etag: string }>
  getObject(key: string): Promise<ReadableStream>
  signUrl(key: string, ttlSeconds: number): Promise<string>
  deleteObject(key: string): Promise<void>
}
```

Adapters:
- `LocalStorageProvider` — current behavior; writes to `UPLOAD_DIR`. Selected when
  `STORAGE_PROVIDER=local`.
- `S3StorageProvider` — works with **any** S3-compatible provider (Cloudflare R2,
  AWS S3, MinIO, Wasabi, Backblaze B2). Selected when `STORAGE_PROVIDER=s3`.
- `GcsStorageProvider` — future.

### 6.3 Cloudflare R2 (recommended)

R2 has zero egress fees — ideal for a media-heavy app.

```env
STORAGE_PROVIDER=s3
STORAGE_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
STORAGE_BUCKET=vidiaforge-media
STORAGE_REGION=auto
STORAGE_ACCESS_KEY=<R2 access key ID>
STORAGE_SECRET_KEY=<R2 secret access key>
STORAGE_PUBLIC_BASE_URL=https://media.vidiaforge.app  # via R2 custom domain
```

### 6.4 AWS S3

```env
STORAGE_PROVIDER=s3
STORAGE_ENDPOINT=  # leave empty for AWS S3 default
STORAGE_BUCKET=vidiaforge-media
STORAGE_REGION=us-east-1
STORAGE_ACCESS_KEY=<AWS access key ID>
STORAGE_SECRET_KEY=<AWS secret access key>
STORAGE_PUBLIC_BASE_URL=https://media.vidiaforge.app  # CloudFront distribution
```

### 6.5 MinIO (self-hosted, for local dev)

```env
STORAGE_PROVIDER=s3
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_BUCKET=vidiaforge-media
STORAGE_REGION=us-east-1
STORAGE_ACCESS_KEY=minioadmin
STORAGE_SECRET_KEY=minioadmin
STORAGE_PUBLIC_BASE_URL=http://localhost:9000/vidiaforge-media
```

### 6.6 Local FS fallback

```env
STORAGE_PROVIDER=local
UPLOAD_DIR=./uploads
TEMP_DIR=./tmp
CACHE_DIR=./cache
```

This is what the sandbox uses today. No credentials needed.

> **Note**: implementing the `S3StorageProvider` adapter requires `src/` changes
> that are out of scope for the docs-deploy-builder task. The configs in this
> repo are ready; the source change is documented in `docs/REMEDIATION.md`
> Problem F.

---

## 7. AI providers

### 7.1 AICommandEngine (the AI edit assistant)

The `POST /api/ai/edit` endpoint uses an `AICommandEngine` to:
1. Build a system prompt enumerating the command schema.
2. Call the LLM provider.
3. Parse JSON output (strip code fences, slice to outermost `{...}`).
4. Apply deterministic fallbacks for common prompts (`cinematic`, `caption`,
   `silence`, `short`, `speed`) when the LLM fails or returns non-JSON.
5. Validate via Zod schema.
6. Apply safety validator (rejects destructive commands).
7. Returns `{ commands: AICommand[], previewable: true, reversible: true }`.

### 7.2 Provider selection

```env
AI_PROVIDER=zai  # zai | openai | anthropic | gemini
```

| Provider | Env var | Status |
|---|---|---|
| `zai` (z-ai-web-dev-sdk) | n/a | ✅ Default, sandbox-ready |
| `openai` | `OPENAI_API_KEY` | Architecture-ready |
| `anthropic` | `ANTHROPIC_API_KEY` | Architecture-ready |
| `gemini` | `GEMINI_API_KEY` | Architecture-ready |

### 7.3 TranscriptionProvider

For real auto-captions (currently simulated in the captions panel):

```env
TRANSCRIPTION_PROVIDER=openai-whisper  # openai-whisper | deepgram | assemblyai | local
TRANSCRIPTION_API_KEY=...
```

### 7.4 TranslationProvider

For real caption translation (currently simulated):

```env
TRANSLATION_PROVIDER=deepl  # deepl | google | llm | libretranslate
TRANSLATION_API_KEY=...
```

### 7.5 AI safety

- System prompt enumerates the command schema — the LLM cannot invent commands.
- Schema validator (Zod) rejects out-of-range parameters.
- Safety validator rejects destructive commands (`delete_all_clips` etc.).
- Every AI command is previewable + reversible via `TimelineCommandEngine.apply()`
  (target — see `docs/REMEDIATION.md` Problem M).

---

## 8. Environment variables

See `.env.example` for the canonical template. Summary:

| Category | Variables | Server-only? |
|---|---|---|
| Runtime | `NODE_ENV` | yes |
| Database | `DATABASE_URL` | yes |
| Queue | `REDIS_URL` | yes |
| Auth | `JWT_SECRET`, `SESSION_SECRET` | yes (secrets) |
| Storage | `STORAGE_PROVIDER`, `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_PUBLIC_BASE_URL` | mixed — see below |
| Local fallback | `UPLOAD_DIR`, `TEMP_DIR`, `CACHE_DIR` | yes |
| AI | `AI_PROVIDER`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` | yes (keys) |
| Transcription | `TRANSCRIPTION_PROVIDER`, `TRANSCRIPTION_API_KEY` | yes (keys) |
| Translation | `TRANSLATION_PROVIDER`, `TRANSLATION_API_KEY` | yes (keys) |
| CORS | `CORS_ORIGIN` | yes |
| Public (browser) | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_STORAGE_PUBLIC_BASE_URL` | **no** — safe to expose |

**Critical**: only `NEXT_PUBLIC_*` variables are safe in the browser bundle.
Server-only secrets (`DATABASE_URL`, `STORAGE_SECRET_KEY`, `JWT_SECRET`,
`OPENAI_API_KEY`, etc.) must NEVER be set in `NEXT_PUBLIC_*` keys. The
`netlify.toml` file documents this explicitly — Netlify only receives
`NEXT_PUBLIC_*` values; server secrets live in Render's keychain.

---

## 9. Development

### 9.1 Common scripts

```bash
bun run dev          # Next.js dev server on :3000 (Turbopack)
bun run build        # Production build → .next/standalone
bun run start        # Run production build → bun .next/standalone/server.js
bun run lint         # ESLint
bun run db:push      # Push Prisma schema → SQLite (sandbox)
bun run db:generate  # Regenerate Prisma client
bun run db:migrate   # Create + apply a migration (Postgres mode)
bun run db:reset     # Drop + recreate DB (destructive!)
```

### 9.2 Editor layout

The app is a single-route SPA — `src/app/page.tsx` reads view state from
Zustand (`src/stores/ui-store.ts`) and renders one of: `landing`, `login`,
`register`, `dashboard`, `editor`, `settings`.

The editor view (`src/components/views/editor-view.tsx`) composes:
- `editor-top-bar.tsx` — project name, undo/redo, save status, AI/Share/Export
- `left-sidebar.tsx` — 12-tab panel switcher (Media/Audio/Text/Captions/Stickers/Effects/Filters/Transitions/Templates/AI/BrandKit/Elements)
- `center-preview.tsx` — video canvas, transport, timecode
- `right-inspector.tsx` — Transform/Crop/Color/Speed/Audio/Text/Effects/Keyframes
- `bottom-timeline.tsx` — multi-track clips, playhead, ruler, markers, zoom
- 12 panels under `src/components/editor/panels/`
- Dialogs: Export, Share, Settings, Keyboard Shortcuts

### 9.3 Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Space` | Play / Pause |
| `←` / `→` | Previous / Next frame |
| `Home` / `End` | Go to start / end |
| `S` | Split at playhead |
| `Delete` | Delete selected clip |
| `D` | Duplicate clip |
| `I` / `O` | Mark in / out |
| `V` / `B` / `H` | Select / Blade / Hand tool |
| `⌘/Ctrl + Z` | Undo |
| `⌘/Ctrl + ⇧ + Z` | Redo |
| `⌘/Ctrl + S` | Save now |
| `⌘/Ctrl + E` | Export |
| `?` | Show shortcuts |

---

## 10. Testing

> **Status**: This repository does **not** ship automated tests. The sandbox
> verification is done end-to-end via the Agent Browser harness (see worklog
> Task ID 4-12). The `tests/` directory contains shell scripts used for runtime
> container smoke tests, not unit tests.

### 10.1 Manual smoke test

1. Start the dev server: `bun run dev`
2. Open `http://localhost:3000`
3. Register a user → land on the dashboard
4. Create a project (16:9, 1080p, 30fps)
5. Open the editor → add a text clip to the timeline
6. Verify the inspector shows the text properties
7. Verify autosave fires (PATCH /api/projects/[id] → 200)

### 10.2 API smoke test

```bash
# Health
curl http://localhost:3000/api/health
# → { status: "ok", db: "connected", time: "..." }

# Register
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@vidiaforge.app","password":"hunter2","name":"Test"}' \
  -c /tmp/cookies.txt

# Create project
curl -X POST http://localhost:3000/api/projects \
  -H "Content-Type: application/json" \
  -b /tmp/cookies.txt \
  -d '{"name":"My First Project","canvasPreset":"16:9","resolution":"1080p","fps":30}'
```

### 10.3 Lint + type-check

```bash
bun run lint                       # ESLint
bunx tsc --noEmit --skipLibCheck   # TypeScript (note: pre-existing errors in
                                   # examples/, skills/, src/lib/types.ts duplicate-color
                                   # issue — see worklog Task ID 3)
```

---

## 11. Production build

### 11.1 Build process

The `bun run build` script (from `package.json`) runs:
```bash
next build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/
```

Next.js 16 `output: "standalone"` produces `.next/standalone/server.js` — a
self-contained Node server with a minimal `node_modules` bundle. The two `cp`
commands inline the static assets + public files into the standalone dir so the
runner image (Dockerfile) is fully self-contained.

### 11.2 Build artifacts

After `bun run build`:

```
.next/
├── standalone/        # ← runner image WORKDIR
│   ├── server.js     # entry point (Node-compatible)
│   ├── node_modules/  # minimal prod deps
│   ├── .next/static/  # static assets (copied by post-build step)
│   └── public/        # PWA manifest, icons, robots.txt
├── static/            # original static assets
└── ...                # Next.js internal build cache
```

### 11.3 `ignoreBuildErrors` note

`next.config.ts` currently has `typescript.ignoreBuildErrors: true`. This is
intentional — there are pre-existing `tsc` errors in `examples/`, `skills/`,
and a duplicate-color issue in `src/lib/types.ts` that are out of scope for
this task. A follow-on `types-cleanup` task should fix these + remove the flag.
The flag does NOT affect runtime correctness — it only skips type-checking at
build time. See `docs/REMEDIATION.md` Problem O.

---

## 12. Netlify deployment

### 12.1 What Netlify hosts

Netlify hosts the **frontend** — the Next.js App Router pages (landing, auth,
dashboard, editor, settings) + static assets (`/_next/static/*`, public/).
The API routes are deployed to Render (see §13).

### 12.2 Setup

1. Push this repo to GitHub.
2. In Netlify: "Add new site" → "Import an existing project" → pick the repo.
3. Netlify auto-detects `netlify.toml` and applies the build config.
4. Set environment variables in Netlify → Site settings → Environment:
   - `NEXT_PUBLIC_API_URL` → your Render API origin (e.g. `https://vidiaforge-api.onrender.com`)
   - `NEXT_PUBLIC_APP_NAME` → `VidiaForge`
   - `NEXT_PUBLIC_STORAGE_PUBLIC_BASE_URL` → your CDN hostname
5. Deploy.

### 12.3 What `netlify.toml` does

- **Build**: `bun run build` on Node 22 via `@netlify/plugin-nextjs`
- **Security headers**: X-Frame-Options DENY, X-Content-Type-Options nosniff,
  Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy
  (allows camera/microphone/display-capture for the recording feature),
  HSTS, Content-Security-Policy
- **Caching**: `/_next/static/*` cached for 1 year (immutable)
- **API proxy**: `/api/*` requests are forwarded to `${NEXT_PUBLIC_API_URL}/api/*`
  via a rewrite, so the frontend code can use relative URLs in dev and absolute
  URLs in production without code changes

### 12.4 What Netlify does NOT receive

Server-only secrets — `DATABASE_URL`, `STORAGE_SECRET_KEY`, `JWT_SECRET`,
`SESSION_SECRET`, `OPENAI_API_KEY`, etc. These live only in Render's keychain.
Setting them in Netlify would expose them in the client bundle.

---

## 13. Render deployment

### 13.1 What Render hosts

Render hosts:
- **`vidiaforge-api`** — web service running `bun .next/standalone/server.js`
  on Node 22, health check `/api/health`. Serves all 16 API routes + SSR
  fallback for any non-API path.
- **`vidiaforge-worker`** — background worker running `bun run worker:start`.
  Same image as the API service, different start command. No HTTP health check
  (Render's worker service type doesn't expose HTTP).
- **`vidiaforge-db`** — managed PostgreSQL 15.
- **`vidiaforge-redis`** — managed Redis 7.

### 13.2 Setup via Blueprint

1. Push this repo to GitHub.
2. In Render: "New" → "Blueprint" → pick the repo.
3. Render reads `render.yaml` and provisions all 4 resources.
4. Set the `sync: false` env vars in Render → Environment:
   - `JWT_SECRET`, `SESSION_SECRET` (generate with `openssl rand -hex 32`)
   - `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION`,
     `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_PUBLIC_BASE_URL`
   - `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` (whichever you use)
   - `TRANSCRIPTION_*`, `TRANSLATION_*` (if using)
   - `CORS_ORIGIN` → your Netlify origin (e.g. `https://vidiaforge.netlify.app`)
   - `NEXT_PUBLIC_API_URL` → your Render API origin
   - `NEXT_PUBLIC_STORAGE_PUBLIC_BASE_URL` → matches `STORAGE_PUBLIC_BASE_URL`
5. Deploy.

### 13.3 `preDeployCommand`

The `vidiaforge-api` service has:
```yaml
preDeployCommand: bun run db:generate && bunx prisma migrate deploy
```

This runs Prisma migrations on every deploy, ensuring the DB schema is always
up-to-date. Requires `prisma/migrations/` to exist — created by `prisma
migrate dev --name init` after switching the schema to `provider = "postgresql"`.

### 13.4 Worker runtime note

Render's Node runtime does NOT include FFmpeg. For full production render
capability, switch the worker service from `runtime: node` to `runtime: docker`
and point it at `worker.Dockerfile`. See the comment block at the bottom of
`render.yaml` for the exact change.

---

## 14. Worker deployment

### 14.1 Worker responsibilities

The worker (`mini-services/worker/`, architecture-ready) is a long-running
process that polls Redis for jobs on:

| Queue | Job type | Steps |
|---|---|---|
| `queue:media-ingest` | MEDIA_INGEST | FFprobe → thumbnail → waveform → proxy → patch MediaAsset |
| `queue:render` | RENDER | Resolve timeline → FFmpeg filtergraph → encode → upload → patch RenderJob |
| `queue:ai-transcribe` | AI_TRANSCRIBE | Resolve audio → call TranscriptionProvider → patch AIJob |
| `queue:ai-translate` | AI_TRANSLATE | Resolve captions → call TranslationProvider → patch AIJob |
| `queue:render-cancel` | (signal) | SIGKILL ffmpeg if a cancel arrives mid-render |

### 14.2 Building the worker image

```bash
docker build -t vidiaforge-worker:latest -f worker.Dockerfile .
```

The `worker.Dockerfile` includes a build-time FFmpeg verification step:

```dockerfile
RUN ffmpeg -version | head -n 1 && \
    ffprobe -version | head -n 1 && \
    echo "FFmpeg + ffprobe verified OK"
```

This fails the build if FFmpeg is missing — no silent broken images.

### 14.3 Running the worker locally

```bash
docker compose up -d worker
docker compose logs -f worker
```

### 14.4 Worker start command

The `package.json` does not yet declare `worker:start` — this script will be
added when `mini-services/worker/index.ts` is created. The intended command is:

```json
"worker:start": "bun mini-services/worker/index.ts"
```

Until then, the worker container will exit with a clear "script not found"
error — by design, so the worker never silently runs nothing.

### 14.5 Worker scaling

For production load, scale the worker horizontally:
- 1 worker instance handles ~1 concurrent render job.
- A 4-core machine can typically handle 2-3 parallel FFmpeg processes (each
  uses 1-2 cores depending on the filtergraph complexity).
- Set the worker count in Render's dashboard (Render supports autoscaling on
  the standard plan and above).

---

## 15. Troubleshooting

### 15.1 `bun run dev` fails with "Cannot find module 'z-ai-web-dev-sdk'"

```bash
bun install  # ensure all deps are installed
```

### 15.2 Prisma errors on first run

```bash
bun run db:generate  # regenerate client
bun run db:push      # create SQLite DB + tables (sandbox)
```

### 15.3 Docker Compose: app fails to start

Check that:
- `docker compose ps` shows `postgres` and `redis` as `healthy`
- `DATABASE_URL` and `REDIS_URL` in `docker-compose.yml` point at the service
  names (`postgres`, `redis`), not `localhost`
- The app container has finished its 60-second `start_period` before its
  healthcheck kicks in

### 15.4 Render deployment: worker exits immediately

This is expected until `mini-services/worker/index.ts` is created. See
`docs/REMEDIATION.md` Problem A. The `bun run worker:start` script doesn't
exist yet — the worker will exit with a clear error.

### 15.5 Netlify deployment: `/api/*` calls return 404

- Verify `NEXT_PUBLIC_API_URL` is set in Netlify → Site settings → Environment
- Verify the Render API service is up (`curl https://vidiaforge-api.onrender.com/api/health`)
- Check the rewrite rule in `netlify.toml` — it should forward to
  `${NEXT_PUBLIC_API_URL}/api/:splat`

### 15.6 FFmpeg drawtext: "Cannot find font"

The Dockerfile installs `font-dejavu` + `ttf-dejavu-core`. If you use a custom
font, mount it at `/usr/share/fonts/truetype/<your-font>/` and run
`fc-cache -fv` in the image.

### 15.7 Upload fails with 415 (Unsupported Media Type)

The MIME whitelist is in `src/app/api/assets/upload/route.ts`. Allowed types:
video/mp4, video/quicktime, video/webm, audio/mpeg, audio/wav, audio/aac,
audio/m4a, audio/ogg, image/jpeg, image/png, image/webp, image/gif.

### 15.8 Build fails on Render with `tsc` errors

`next.config.ts` has `typescript.ignoreBuildErrors: true` — so this should
NOT happen. If it does, you likely have a different `next.config.ts` — check
that the file matches the one in this repo.

### 15.9 Database connection: "too many connections"

Prisma uses a connection pool. The default `connection_limit` is
`num_cpus * 2 + 1`. On Render's starter plan (1 vCPU), this is 3. For higher
load, increase the pool size via the `?connection_limit=10` query param on
`DATABASE_URL`, or upgrade to a higher Postgres plan.

### 15.10 Storage: signed URLs expire before download completes

Default signed-URL TTL is 1 hour. For very large files, increase the TTL in
`StorageProvider.signUrl(key, ttlSeconds)`.

---

## 16. Media engine architecture

### 16.1 Upload → MEDIA_INGEST flow

```
[Browser] POST /api/assets/upload (multipart)
   │
   ▼
[API] MIME whitelist + size cap + project ownership check
   │
   ▼
[API] StorageProvider.putObject("media/source/<userId>/<uuid>.<ext>", buffer, mime)
   │
   ▼
[API] db.mediaAsset.create({ storagePath, kind, ... }) → return 201
   │
   ▼
[API] Redis RPUSH "queue:media-ingest" { assetId }  ← (target; today: synchronous stub)
   │
   ▼
[Worker] BLPOP "queue:media-ingest" → fetch asset
   │
   ▼
[Worker] FFprobe(asset) → duration, width, height, fps, codec, audioChannels
   │
   ▼
[Worker] ffmpeg -ss <mid> -i <asset> -frames:v 1 -vf scale=480:-1 thumb.png
   │
   ▼
[Worker] ffmpeg -i <asset> -filter_complex "showwavespic=s=1280x120" wave.png
   │
   ▼
[Worker] ffmpeg -i <asset> -vf scale=854:-2 -c:v libx264 -preset fast -crf 28 proxy.mp4
   │
   ▼
[Worker] StorageProvider.putObject("media/thumb/<assetId>.png", ...)
         StorageProvider.putObject("media/wave/<assetId>.png", ...)
         StorageProvider.putObject("media/proxy/<assetId>.mp4", ...)
   │
   ▼
[Worker] db.mediaAsset.update({ duration, width, height, fps, codec,
         audioChannels, thumbnailUrl: signedUrl, waveformUrl: signedUrl })
```

### 16.2 Proxy media

Proxy media is a 480p H.264 transcode of the source, used for smooth preview
playback in the editor. The original is preserved for the final render.

### 16.3 Thumbnail + waveform

- **Thumbnail**: poster frame at the midpoint of the asset, scaled to 480px wide
- **Waveform**: 1280×120 PNG rendering of the audio amplitude over time,
  amber-colored to match the VidiaForge theme

### 16.4 Status

This entire pipeline is **architecture-ready** — it requires the worker source
(`mini-services/worker/`), which is a follow-on task. See `docs/REMEDIATION.md`
Problem K.

---

## 17. Project schema

### 17.1 Prisma models

Defined in `prisma/schema.prisma`:

| Model | Purpose |
|---|---|
| `User` | id, email, name, passwordHash, avatarUrl, plan, relations to Project/MediaAsset/Session/UserPreferences |
| `Session` | id, userId, token, expiresAt (httpOnly cookie auth) |
| `Project` | id, userId, name, canvas, timelineData (JSON), duration, thumbnailUrl, favorite, lastSnapshot, lastSavedAt |
| `ProjectVersion` | id, projectId, label, snapshot (full timeline JSON for undo history) |
| `MediaAsset` | id, userId, projectId, filename, internalName, mimeType, size, storagePath, kind, duration, width, height, fps, codec, audioChannels, thumbnailUrl, waveformUrl |
| `RenderJob` | id, projectId, status, format, codec, resolution, fps, bitrate, progress, stage, outputUrl, error, startedAt, completedAt |
| `AIJob` | id, userId, projectId, kind, status, input, output, provider, error, completedAt |
| `Template` | id, name, category, description, thumbnailUrl, canvasPreset, duration, timelineData, isBuiltin |
| `UserPreferences` | userId (PK), theme, timecodeFormat, snap, magneticTimeline, autoSave, autoSaveInterval, proxyMedia, playbackSpeed, defaultCanvasPreset, defaultResolution, defaultFps, shortcuts (JSON), brandKit (JSON) |

### 17.2 TimelineState JSON shape

Defined in `src/lib/types.ts`. The non-destructive timeline model:

```ts
interface TimelineState {
  schemaVersion: number;          // 1
  tracks: TimelineTrack[];        // video, audio, text, subtitle, overlay, adjustment
  clips: TimelineClip[];          // source-in/out, transform, crop, color, audio,
                                  //   effects (16 types), filters (11 types),
                                  //   transitions (17 types), keyframes, masks, text, caption
  markers: TimelineMarker[];
  inPoint?: number;
  outPoint?: number;
}
```

This JSON is stored as a string in `Project.timelineData`. The schema is
versioned via `schemaVersion` — future migrations can increment this and
write a migration function.

### 17.3 Compatibility invariant

The migration to PostgreSQL + object storage **must** preserve the
`TimelineState` JSON shape — it round-trips through the editor store
(Zustand) → IndexedDB (target) → Postgres without transformation. See
`docs/REMEDIATION.md` "Compatibility invariants" for the full list.

---

## 18. Rendering architecture

### 18.1 Render flow

```
[Browser] POST /api/render { projectId, format, codec, resolution, fps, bitrate }
   │
   ▼
[API] Verify ownership → create RenderJob (status: "queued")
   │
   ▼
[API] Redis RPUSH "queue:render" { jobId }
   │
   ▼
[Worker] BLPOP "queue:render" → fetch RenderJob + Project.timelineData
   │
   ▼
[Worker] For each clip in timeline:
         - Fetch source from StorageProvider (signed GET URL or stream)
         - Apply per-clip transform (scale/crop/rotate/opacity)
         - Apply colorAdjust (eq filter)
         - Apply effects (avgblur, vignette, boxblur, etc.)
         - Apply filters (curves LUT)
         - Apply transitions (xfade between adjacent clips)
         - Apply keyframes (between= expressions)
         - Burn in text overlays (drawtext with DejaVu fonts)
         - Burn in captions (subtitles= filter from SRT)
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
         { status: "processing", progress: 0..1, stage: "encoding|muxing|uploading" }
   │
   ▼
[Worker] StorageProvider.putObject("renders/<jobId>.mp4", stream, "video/mp4")
   │
   ▼
[Worker] signedUrl = StorageProvider.signUrl("renders/<jobId>.mp4", ttl=24h)
   │
   ▼
[Worker] db.renderJob.update({
         status: "completed",
         outputUrl: signedUrl,
         progress: 1,
         completedAt: new Date()
       })
   │
   ▼
[Browser] Polls GET /api/render/[id] → receives signedUrl → triggers download
```

### 18.2 Cancellation

`POST /api/render/[id]/cancel` sets `status = "cancelled"` and
`RPUSH "queue:render-cancel" { jobId }`. The worker's poll loop checks both
queues; if a cancel arrives mid-render, the worker `SIGKILL`s the ffmpeg
process and patches the job as cancelled.

### 18.3 Filtergraph complexity

The hardest part of the worker is building the FFmpeg filtergraph. The
timeline model supports:

- **16 effects** (blur, gaussian-blur, motion-blur, glow, sharpen, vignette,
  noise, grain, chromatic-aberration, glitch, pixelate, vhs, film, rgb-split,
  lens-distortion, bloom)
- **11 filters** (cinematic, warm, cool, vintage, film, bw, high-contrast,
  moody, vibrant, portrait, golden-hour)
- **17 transitions** (cut, cross-dissolve, fade, dip-to-black, dip-to-white,
  wipe, slide, zoom, blur, spin, glitch, light-leak, film-burn, flash,
  whip-pan, morph, push)
- **12 color controls** (exposure, brightness, contrast, highlights, shadows,
  whites, blacks, saturation, vibrance, temperature, tint, hue)
- **Keyframes** (position, scale, rotation, opacity, volume, color, with
  easing: linear, ease-in, ease-out, ease-in-out, cubic, bezier)
- **Masks** (rectangle, circle, polygon, freehand)
- **Text overlays** (8 presets, 10 animations)
- **Captions** (7 styles, 13-language translation)

A first-cut worker can support a subset (cuts, fades, text, color, basic
effects) and expand iteratively. The full filtergraph is constructed in
`mini-services/worker/render-engine/build-filtergraph.ts` (target).

### 18.4 Output formats

| Format | Codec | Use case |
|---|---|---|
| `mp4` (default) | libx264 + aac | Universal compatibility |
| `webm` | libvpx-vp9 + libopus | Smaller files, modern browsers |

### 18.5 Bitrate presets

| Bitrate | Video (1080p) | Audio |
|---|---|---|
| `low` | 2 Mbps | 96 kbps |
| `medium` (default) | 5 Mbps | 192 kbps |
| `high` | 10 Mbps | 256 kbps |
| `custom` | user-specified | user-specified |

### 18.6 Status

The render flow is **architecture-ready** — the API endpoint exists
(`POST /api/render` creates a `RenderJob` row), the browser polls it, and the
worker deployment config exists. The actual FFmpeg filtergraph builder +
worker source is a follow-on task. See `docs/REMEDIATION.md` Problem A.

In the sandbox today: `POST /api/render` creates the job, the export dialog
simulates progress via `PATCH /api/render/[id]`, and the `outputUrl` is fake.
The browser UI is unchanged in production — same polling contract, real
values.

---

## License

This is a demonstration project built for evaluation purposes.

---

## See also

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — comprehensive architecture document
- [`docs/REMEDIATION.md`](./docs/REMEDIATION.md) — problem-by-problem remediation log (15 items)
- [`CHANGELOG.md`](./CHANGELOG.md) — transformation changelog
- [`.env.example`](./.env.example) — canonical environment template
- [`netlify.toml`](./netlify.toml) — Netlify deployment config
- [`render.yaml`](./render.yaml) — Render Blueprint v2
- [`Dockerfile`](./Dockerfile) — production image (Next.js standalone + FFmpeg)
- [`worker.Dockerfile`](./worker.Dockerfile) — worker image (FFmpeg-verified)
- [`docker-compose.yml`](./docker-compose.yml) — local dev with postgres + redis + app + worker
- [`worklog.md`](./worklog.md) — master worklog

---

End of `README.md`.
