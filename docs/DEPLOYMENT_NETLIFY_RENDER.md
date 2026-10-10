# VidiaForge — Deployment Guide (Netlify + Render)

> **Audience.** Operators deploying VidiaForge to production for the first
> time. This document is the **single source of truth** for the production
> deployment split:
>
> - **Netlify** hosts the Next.js 16 frontend (landing, auth, dashboard,
>   editor, settings views + static assets).
> - **Render** hosts the API (Next.js standalone server) and the worker
>   (Bun + Docker + FFmpeg).
> - **Render** also hosts the managed PostgreSQL + Redis.
> - **Cloudflare R2 or AWS S3** (or any S3-compatible object storage)
>   hosts source media, thumbnails, waveforms, proxies, and rendered
>   output.
>
> The repo's deployment configs (`netlify.toml`, `render.yaml`,
> `Dockerfile`, `worker.Dockerfile`, `docker-compose.yml`) implement
> this split. Follow the steps below in order.

---

## 1. Prerequisites

### 1.1 Local development environment

| Tool | Version | Why |
|---|---|---|
| Node.js | 22.x | Required by Netlify build + Render `node` runtime |
| Bun | 1.x | Required for installs, tests, build (faster + lockfile-stable than npm/yarn) |
| Docker | 24+ | For local `worker.Dockerfile` builds + docker-compose dev stack |
| FFmpeg | 6.x+ | Local dev render pipeline + media ingestion (optional in dev — worker degrades gracefully) |
| FFprobe | ships with FFmpeg | Local dev metadata extraction |
| Git | 2.x | Source control + Render/Netlify auto-deploy |

Install:

```bash
# Node 22 via nvm
nvm install 22 && nvm use 22

# Bun
curl -fsSL https://bun.sh/install | bash

# Docker (Linux)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER  # log out + back in after

# FFmpeg + FFprobe (macOS)
brew install ffmpeg

# FFmpeg + FFprobe (Ubuntu/Debian)
sudo apt-get update && sudo apt-get install -y ffmpeg

# Verify
node --version    # v22.x
bun --version     # 1.x
docker --version  # Docker version 24.x
ffmpeg -version   # ffmpeg version 6.x
ffprobe -version  # ffprobe version 6.x
```

### 1.2 Accounts

| Service | Plan | Why |
|---|---|---|
| GitHub | Free | Source repo + Render/Netlify auto-deploy source |
| Netlify | Free (Starter) | Frontend hosting + CDN |
| Render | Individual | API web service + worker + Postgres + Redis |
| Cloudflare R2 OR AWS S3 | Free tier (R2) / pay-as-you-go (S3) | Object storage for media + renders |

---

## 2. Local development setup

### 2.1 Clone + install

```bash
git clone https://github.com/<your-org>/vidiaforge.git
cd vidiaforge
bun install
```

### 2.2 Environment variables (.env.local)

Copy the example and fill in local values. The dev server reads `.env.local`
automatically. **Do NOT commit `.env.local`.**

```bash
cp .env.example .env.local
# Edit .env.local per the table below
```

| Env var | Local dev value | Notes |
|---|---|---|
| `DATABASE_URL` | `file:./db/custom.db` | SQLite fallback for dev — set to Render Postgres URL in production |
| `REDIS_URL` | (unset in dev) | If you want to test the worker locally, set to `redis://localhost:6379` (see §2.4) |
| `JWT_SECRET` | any 32+ char random string | `openssl rand -hex 32` |
| `SESSION_SECRET` | any 32+ char random string | `openssl rand -hex 32` |
| `STORAGE_PROVIDER` | `local` (default) | Use `s3` or `r2` in production |
| `UPLOAD_DIR` | `./uploads` | Local storage root (relative to CWD) |
| `AI_PROVIDER` | `zai` | Uses the in-repo `z-ai-web-dev-sdk` |
| `TRANSCRIPTION_PROVIDER` | (unset in dev) | Optional — `openai`, `deepgram`, or `local` |
| `TRANSCRIPTION_API_KEY` | (unset in dev) | Required if `TRANSCRIPTION_PROVIDER` is set |
| `NEXT_PUBLIC_API_URL` | (unset in dev) | Same-origin in dev; set to Render origin in Netlify production |
| `NEXT_PUBLIC_APP_NAME` | `VidiaForge` | Browser title + PWA name |

### 2.3 Database (SQLite fallback for dev)

The dev server defaults to SQLite (`file:./db/custom.db`). The Prisma schema
is provider-agnostic — to switch to PostgreSQL locally, change
`prisma/schema.prisma` line 10 to `provider = "postgresql"` and set
`DATABASE_URL` to your local Postgres URL.

```bash
# Initialize the SQLite DB + apply migrations
bun run db:push  # dev-only: pushes schema without creating a migration

# OR apply the committed migrations (recommended — matches production):
bunx prisma migrate deploy
```

### 2.4 Optional: Redis via Docker

The worker requires Redis to consume BullMQ jobs. To run the worker locally:

```bash
docker run -d --name vidiaforge-redis -p 6379:6379 redis:7-alpine
# Set in .env.local: REDIS_URL=redis://localhost:6379
```

### 2.5 Run the dev server

```bash
bun run dev
# http://localhost:3000
```

### 2.6 Run the worker (optional, requires Redis)

```bash
# In a second terminal
bun run worker:dev
# Watch for: "VIDIAFORGE WORKER READY" in the logs
# Health check: curl http://localhost:3001/health
```

### 2.7 Run tests

```bash
bun test                  # all tests (unit + integration + smoke — skips infra-dependent tests)
bun run test:unit         # unit tests only (no infrastructure required)
bun run test:integration  # integration tests (skip cleanly if no Redis/FFmpeg)
bun run test:render       # deterministic render smoke test (skip cleanly if no FFmpeg)
bun run test:e2e          # E2E tests against a deployed environment (skip if no E2E_API_URL)

# Generate test fixtures (one-time, requires FFmpeg)
bun run fixtures:generate
```

---

## 3. PostgreSQL setup (Render managed OR local Docker)

### 3.1 Render managed PostgreSQL (recommended for production)

The `render.yaml` blueprint declares a `vidiaforge-db` PostgreSQL 15
resource. It is created automatically on first blueprint deploy (see §7).

To create it manually (alternative to blueprint):

1. Render dashboard → New + → PostgreSQL
2. Name: `vidiaforge-db`
3. Database: `vidiaforge`
4. User: `vidiaforge` (Render auto-generates a strong password)
5. Region: `oregon` (match the API service region)
6. Plan: `starter` (includes automated backups; upgrade to `standard` for production load)
7. IP Allow List: `0.0.0.0/0` (Render internal network — services can connect)

Render provides the connection string in the format:
`postgresql://vidiaforge:<password>@<host>.render.com:5432/vidiaforge`

### 3.2 Local Docker PostgreSQL (for local dev)

```bash
docker run -d --name vidiaforge-pg \
  -e POSTGRES_DB=vidiaforge \
  -e POSTGRES_USER=vidiaforge \
  -e POSTGRES_PASSWORD=vidiaforge \
  -p 5432:5432 \
  postgres:15-alpine

# Set in .env.local:
# DATABASE_URL=postgresql://vidiaforge:vidiaforge@localhost:5432/vidiaforge

# Apply migrations
bunx prisma migrate deploy
```

---

## 4. Redis setup (Render managed OR local Docker)

### 4.1 Render managed Redis (recommended for production)

The `render.yaml` blueprint declares a `vidiaforge-redis` Redis 7 resource.

To create manually:

1. Render dashboard → New + → Redis
2. Name: `vidiaforge-redis`
3. Region: `oregon`
4. Plan: `starter` (upgrade to `standard` for production load)
5. IP Allow List: `0.0.0.0/0` (Render internal network)

Render provides the connection string in the format:
`redis://red-<id>:<password>@<host>.render.com:6379`

### 4.2 Local Docker Redis

See §2.4.

---

## 5. Object storage setup (Cloudflare R2 OR AWS S3)

VidiaForge's `S3StorageProvider` is compatible with any S3-API storage.
**Cloudflare R2 is recommended** because it has zero egress fees (R2 → CDN
→ browser is free). AWS S3 also works.

### 5.1 Cloudflare R2

1. Cloudflare dashboard → R2 → Create bucket
2. Bucket name: `vidiaforge-media` (or your choice — set as `STORAGE_BUCKET`)
3. Region: auto (R2 is global)
4. Settings → API Tokens → Create API token:
   - Token name: `vidiaforge`
   - Permissions: Object Read + Write
   - Specify bucket: `vidiaforge-media`
   - TTL: forever (or rotate yearly)
5. Note the credentials:
   - Access Key ID → `STORAGE_ACCESS_KEY`
   - Secret Access Key → `STORAGE_SECRET_KEY`
   - Endpoint: `https://<account-id>.r2.cloudflarestorage.com` → `STORAGE_ENDPOINT`
   - Region: `auto` → `STORAGE_REGION`
6. Optional: enable public bucket access via Cloudflare's R2 public URL
   feature — set the public URL as `STORAGE_PUBLIC_BASE_URL` (e.g.
   `https://pub-<id>.r2.dev`) so renders can be downloaded without
   signed URLs.

### 5.2 AWS S3

1. AWS console → S3 → Create bucket
2. Bucket name: `vidiaforge-media` (must be globally unique)
3. Region: `us-east-1` (or your choice — set as `STORAGE_REGION`)
4. Block all public access: yes (we use signed URLs)
5. IAM → Users → Create user `vidiaforge-app` → Attach inline policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket", "s3:HeadObject"],
      "Resource": [
        "arn:aws:s3:::vidiaforge-media",
        "arn:aws:s3:::vidiaforge-media/*"
      ]
    }
  ]
}
```

6. Create access key → note:
   - Access Key ID → `STORAGE_ACCESS_KEY`
   - Secret Access Key → `STORAGE_SECRET_KEY`
   - Endpoint: `https://s3.us-east-1.amazonaws.com` → `STORAGE_ENDPOINT`
   - Region: `us-east-1` → `STORAGE_REGION`

### 5.3 Object key layout

The worker writes objects using the following key conventions:

| Path | Written by | Contents |
|---|---|---|
| `uploads/<userId>/<internalName>.<ext>` | `POST /api/assets/upload` | Source media (browser upload) |
| `thumbnails/<assetId>.jpg` | Worker media-ingestion | Poster frame (640px wide JPEG) |
| `waveforms/<assetId>.png` | Worker media-ingestion | Audio waveform image (1280×120 PNG) |
| `proxies/<assetId>.mp4` | Worker media-ingestion | 720p H.264 proxy for >1080p source |
| `renders/<renderJobId>/output.<ext>` | Worker render pipeline | Rendered output (deterministic key for idempotency) |

The render output key is `renders/{renderJobId}/output.{ext}` — same job ID
always produces the same key, enabling the `FFmpegRenderService` idempotency
check (if the output already exists, skip the render).

---

## 6. Netlify frontend deployment

### 6.1 Connect the repo

1. Netlify dashboard → Add new site → Import an existing project
2. Connect to GitHub → select the `vidiaforge` repo
3. Branch to deploy: `main`
4. Build configuration (Netlify auto-detects from `netlify.toml`):
   - Build command: `bun run build`
   - Publish directory: `.next`
5. Plugins: `@netlify/plugin-nextjs` is auto-installed from `netlify.toml`

### 6.2 Environment variables (Netlify site settings → Environment)

**CRITICAL.** Only `NEXT_PUBLIC_*` vars belong here. Server-only secrets
(DATABASE_URL, STORAGE_SECRET_KEY, JWT_SECRET, etc.) MUST NOT be set
in Netlify — they belong in Render (§7.2). Setting them in Netlify would
expose them in the client bundle.

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://vidiaforge-api.onrender.com` | Your Render API origin (set in §7.1). The `/api/*` rewrite in `netlify.toml` forwards browser API calls to this origin. |
| `NEXT_PUBLIC_APP_NAME` | `VidiaForge` | Browser title + PWA name |
| `NEXT_PUBLIC_STORAGE_PUBLIC_BASE_URL` | `https://pub-<id>.r2.dev` | R2 public URL (only if you enabled public access in §5.1) |
| `NODE_VERSION` | `22` | Already set in `netlify.toml` |
| `NETLIFY_USE_BUN` | `true` | Already set in `netlify.toml` |

### 6.3 Deploy

1. Netlify dashboard → Deploys → Trigger deploy → Deploy site
2. Wait for build to complete (3-5 min on first deploy; Bun install + Next.js build)
3. Netlify assigns a URL: `https://<site-name>.netlify.app`
4. Optional: add a custom domain (Domain settings → Add custom domain)

### 6.4 Verify

```bash
curl https://<site-name>.netlify.app
# Expect: HTML with the VidiaForge landing page

curl https://<site-name>.netlify.app/api/health
# Expect: 200 JSON { status: "ok", db: "connected" } (proxied to Render)
```

---

## 7. Render API deployment

### 7.1 Via the render.yaml blueprint (recommended)

```bash
# Install the Render CLI
curl -fsSL https://render.com/install-render-cli.sh | bash

# Login
render login

# Apply the blueprint (creates the API + worker + Postgres + Redis)
render blueprint deploy
```

Render detects `render.yaml` in the repo root and creates:

- `vidiaforge-api` (web service, Node runtime)
- `vidiaforge-worker` (background worker, Docker runtime)
- `vidiaforge-db` (PostgreSQL 15)
- `vidiaforge-redis` (Redis 7)

### 7.2 Via the dashboard (alternative)

1. Render dashboard → New + → Web Service
2. Connect to GitHub → select the `vidiaforge` repo
3. Name: `vidiaforge-api`
4. Runtime: `Node` (Node 22 — Render auto-detects from `package.json`)
5. Build command: `bun install --frozen-lockfile && bun run build`
6. Start command: `bun .next/standalone/server.js`
7. Health check path: `/api/health`
8. Pre-deploy command: `bun run db:generate && bun run db:migrate:deploy`
9. Instance plan: `Starter` ($7/mo) or `Standard` ($25/mo) for production load
10. Region: `oregon` (match your DB + Redis region)
11. Branch: `main`
12. Auto-deploy: yes (recommended)

### 7.3 Environment variables (Render → vidiaforge-api → Environment)

Most are pre-wired via `render.yaml` (resources + safe inlines). The
`sync: false` ones (secrets) MUST be set manually:

| Variable | Source | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Set in `render.yaml` |
| `DATABASE_URL` | Render `vidiaforge-db` resource | Auto-injected via `fromDatabase` |
| `REDIS_URL` | Render `vidiaforge-redis` resource | Auto-injected via `fromDatabase` |
| `JWT_SECRET` | Manual (Render keychain) | `openssl rand -hex 32` |
| `SESSION_SECRET` | Manual (Render keychain) | `openssl rand -hex 32` |
| `STORAGE_PROVIDER` | `s3` | Set in `render.yaml` |
| `STORAGE_ENDPOINT` | Manual | `https://<account-id>.r2.cloudflarestorage.com` |
| `STORAGE_BUCKET` | Manual | `vidiaforge-media` |
| `STORAGE_REGION` | Manual | `auto` (R2) or `us-east-1` (AWS S3) |
| `STORAGE_ACCESS_KEY` | Manual | From §5.1 or §5.2 |
| `STORAGE_SECRET_KEY` | Manual | From §5.1 or §5.2 |
| `STORAGE_PUBLIC_BASE_URL` | Manual | Optional — R2 public URL |
| `AI_PROVIDER` | `zai` | Set in `render.yaml` |
| `OPENAI_API_KEY` | Manual | Optional — for transcription/translation |
| `ANTHROPIC_API_KEY` | Manual | Optional |
| `GEMINI_API_KEY` | Manual | Optional |
| `TRANSCRIPTION_PROVIDER` | Manual | `openai`, `deepgram`, or `local` |
| `TRANSCRIPTION_API_KEY` | Manual | Required if TRANSCRIPTION_PROVIDER is set |
| `TRANSLATION_PROVIDER` | Manual | Optional |
| `TRANSLATION_API_KEY` | Manual | Optional |
| `CORS_ORIGIN` | Manual | `https://<site-name>.netlify.app` (your Netlify URL from §6.3) |
| `NEXT_PUBLIC_API_URL` | Manual | `https://vidiaforge-api.onrender.com` (this service's URL — must match the public URL) |
| `NEXT_PUBLIC_APP_NAME` | `VidiaForge` | Set in `render.yaml` |
| `NEXT_PUBLIC_STORAGE_PUBLIC_BASE_URL` | Manual | Same as `STORAGE_PUBLIC_BASE_URL` |

### 7.4 Verify API deploy

1. Render dashboard → vidiaforge-api → Logs
2. Wait for "Next.js standalone server started" log
3. Render dashboard → vidiaforge-api → Health check should be `200 OK`
4. Manual check:

```bash
curl https://vidiaforge-api.onrender.com/api/health
# Expect: 200 JSON { status: "ok", db: "connected" }
```

If `db: "disconnected"`, the pre-deploy migration didn't run — check
the `preDeployCommand` log.

---

## 8. Render Worker deployment

### 8.1 Via render.yaml blueprint

The `render.yaml` blueprint declares `vidiaforge-worker` as a `worker`
service with `runtime: docker`. It is created automatically on
`render blueprint deploy` (see §7.1).

### 8.2 Via the dashboard (alternative)

1. Render dashboard → New + → Background Worker
2. Connect to GitHub → select the `vidiaforge` repo
3. Name: `vidiaforge-worker`
4. Runtime: `Docker`
5. Dockerfile path: `./worker.Dockerfile`
6. Docker context: `.`
7. Instance plan: `Standard` ($25/mo — workers need CPU + RAM for FFmpeg;
   do NOT use the free tier)
8. Region: `oregon` (match your DB + Redis region)
9. Branch: `main`
10. Auto-deploy: yes

### 8.3 Environment variables (Render → vidiaforge-worker → Environment)

The worker needs MOST of the same env vars as the API, EXCEPT
`NEXT_PUBLIC_*` (browser-facing) and `CORS_ORIGIN` (the worker doesn't
serve HTTP to the browser):

| Variable | Source | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Set in `render.yaml` |
| `DATABASE_URL` | Render `vidiaforge-db` resource | Auto-injected via `fromDatabase` |
| `REDIS_URL` | Render `vidiaforge-redis` resource | Auto-injected via `fromDatabase` |
| `STORAGE_PROVIDER` | `s3` | Set in `render.yaml` |
| `STORAGE_ENDPOINT` | Manual | Same as API |
| `STORAGE_BUCKET` | Manual | Same as API |
| `STORAGE_REGION` | Manual | Same as API |
| `STORAGE_ACCESS_KEY` | Manual | Same as API |
| `STORAGE_SECRET_KEY` | Manual | Same as API |
| `STORAGE_PUBLIC_BASE_URL` | Manual | Same as API |
| `UPLOAD_DIR` | `/app/uploads` | Set in `render.yaml` + `worker.Dockerfile` |
| `TEMP_DIR` | `/app/tmp` | Set in `render.yaml` + `worker.Dockerfile` |
| `WORKER_CONCURRENCY` | `2` | Set in `render.yaml` — increase for heavier load |
| `WORKER_PORT` | `3001` | Health endpoint port |
| `TRANSCRIPTION_PROVIDER` | Manual | Optional |
| `TRANSCRIPTION_API_KEY` | Manual | Optional |
| `TRANSLATION_PROVIDER` | Manual | Optional |
| `TRANSLATION_API_KEY` | Manual | Optional |

### 8.4 Verify worker deploy

1. Render dashboard → vidiaforge-worker → Logs
2. Wait for the structured JSON health report. Example of a healthy startup:

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
  "ffmpegVersion": "ffmpeg version 6.0 Copyright ...",
  "ffprobeVersion": "ffprobe version 6.0 Copyright ...",
  "storageProvider": "s3",
  "errors": []
}
[worker] running queues: media-ingestion, render, transcription, thumbnail, proxy, ai
[worker] health server on http://localhost:3001/health
VIDIAFORGE WORKER READY
```

3. The string `VIDIAFORGE WORKER READY` is the success signal — if you
   don't see it, the worker exited with code 1 during pre-flight
   validation. Check the `errors[]` array in the health report for
   actionable messages.

4. (Optional) Port-forward the health endpoint:

```bash
# Render doesn't expose worker ports publicly by default.
# Use Render's shell:
render shell vidiaforge-worker
curl http://localhost:3001/health
# Expect: 200 JSON { status: "ok", workers: [...], time: "..." }
```

---

## 9. Post-deploy verification

### 9.1 Health endpoint

```bash
curl https://vidiaforge-api.onrender.com/api/health
# Expect: 200 JSON { status: "ok", db: "connected" }
```

If `db: "disconnected"`, check the API service's `preDeployCommand` log
(`bun run db:migrate:deploy`).

### 9.2 Test upload (creates a MediaAsset)

```bash
# 1. Register + login
curl -X POST https://vidiaforge-api.onrender.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123","name":"Test"}' \
  -c cookies.txt

# 2. Create a project
curl -X POST https://vidiaforge-api.onrender.com/api/projects \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"name":"My first project"}'

# 3. Upload a media file
curl -X POST https://vidiaforge-api.onrender.com/api/assets/upload \
  -b cookies.txt \
  -F "file=@sample.mp4" \
  -F "projectId=<project-id-from-step-2>"

# Expect: 201 JSON { asset: { id, status: "uploading", ... } }
```

### 9.3 Verify media ingestion completed

```bash
# Wait 5-30s for the worker to process, then:
curl https://vidiaforge-api.onrender.com/api/assets \
  -b cookies.txt

# Expect: asset.status === "ready" + thumbnailUrl + duration set
```

If `status: "failed"`, check the worker logs for the `media-ingestion`
processor error message.

### 9.4 Test render

```bash
curl -X POST https://vidiaforge-api.onrender.com/api/render \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "projectId": "<project-id>",
    "format": "mp4",
    "codec": "h264",
    "resolution": "1080p",
    "fps": 30,
    "bitrate": "medium"
  }'

# Expect: 201 JSON { job: { id, status: "queued", ... }, queued: true }
```

### 9.5 Verify render completed

```bash
# Poll the render job status (30s-5min depending on project length):
curl https://vidiaforge-api.onrender.com/api/render/<job-id> \
  -b cookies.txt

# Expect: job.status === "completed" + outputUrl set
```

If `status: "failed"`, check the worker logs for the `render` processor —
the `error` field on the job contains the FFmpeg stderr tail or the
validation failure message.

---

## 10. Environment variables checklist

### 10.1 API service (Render vidiaforge-api)

| Variable | Required? | Source |
|---|---|---|
| `NODE_ENV` | yes | `production` (render.yaml) |
| `DATABASE_URL` | yes | Render `vidiaforge-db` resource (auto-injected) |
| `REDIS_URL` | yes | Render `vidiaforge-redis` resource (auto-injected) |
| `JWT_SECRET` | yes | Manual (Render keychain) |
| `SESSION_SECRET` | yes | Manual (Render keychain) |
| `STORAGE_PROVIDER` | yes | `s3` (render.yaml) |
| `STORAGE_ENDPOINT` | yes | Manual |
| `STORAGE_BUCKET` | yes | Manual |
| `STORAGE_REGION` | yes | Manual (`auto` for R2, `us-east-1` for S3) |
| `STORAGE_ACCESS_KEY` | yes | Manual |
| `STORAGE_SECRET_KEY` | yes | Manual |
| `STORAGE_PUBLIC_BASE_URL` | no | Manual (R2 public URL) |
| `AI_PROVIDER` | yes | `zai` (render.yaml) |
| `OPENAI_API_KEY` | no | Manual (for transcription/translation) |
| `ANTHROPIC_API_KEY` | no | Manual |
| `GEMINI_API_KEY` | no | Manual |
| `TRANSCRIPTION_PROVIDER` | no | Manual (`openai` / `deepgram` / `local`) |
| `TRANSCRIPTION_API_KEY` | no | Manual (required if TRANSCRIPTION_PROVIDER is set) |
| `TRANSLATION_PROVIDER` | no | Manual |
| `TRANSLATION_API_KEY` | no | Manual |
| `CORS_ORIGIN` | yes | Manual (`https://<netlify-site>.netlify.app`) |
| `NEXT_PUBLIC_API_URL` | yes | Manual (`https://vidiaforge-api.onrender.com`) |
| `NEXT_PUBLIC_APP_NAME` | yes | `VidiaForge` (render.yaml) |
| `NEXT_PUBLIC_STORAGE_PUBLIC_BASE_URL` | no | Manual (if R2 public URL is set) |

### 10.2 Worker service (Render vidiaforge-worker)

| Variable | Required? | Source |
|---|---|---|
| `NODE_ENV` | yes | `production` (render.yaml) |
| `DATABASE_URL` | yes | Render `vidiaforge-db` resource (auto-injected) |
| `REDIS_URL` | yes | Render `vidiaforge-redis` resource (auto-injected) |
| `STORAGE_PROVIDER` | yes | `s3` (render.yaml) |
| `STORAGE_ENDPOINT` | yes | Manual |
| `STORAGE_BUCKET` | yes | Manual |
| `STORAGE_REGION` | yes | Manual |
| `STORAGE_ACCESS_KEY` | yes | Manual |
| `STORAGE_SECRET_KEY` | yes | Manual |
| `STORAGE_PUBLIC_BASE_URL` | no | Manual |
| `UPLOAD_DIR` | yes | `/app/uploads` (render.yaml + worker.Dockerfile) |
| `TEMP_DIR` | yes | `/app/tmp` (render.yaml + worker.Dockerfile) |
| `WORKER_CONCURRENCY` | yes | `2` (render.yaml) |
| `WORKER_PORT` | yes | `3001` (render.yaml) |
| `TRANSCRIPTION_PROVIDER` | no | Manual |
| `TRANSCRIPTION_API_KEY` | no | Manual |
| `TRANSLATION_PROVIDER` | no | Manual |
| `TRANSLATION_API_KEY` | no | Manual |
| `AI_PROVIDER` | yes | `zai` (render.yaml) |
| `OPENAI_API_KEY` | no | Manual |
| `ANTHROPIC_API_KEY` | no | Manual |
| `GEMINI_API_KEY` | no | Manual |

### 10.3 Netlify frontend

| Variable | Required? | Source |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | yes | Manual (`https://vidiaforge-api.onrender.com`) |
| `NEXT_PUBLIC_APP_NAME` | yes | `VidiaForge` (netlify.toml) |
| `NEXT_PUBLIC_STORAGE_PUBLIC_BASE_URL` | no | Manual (if R2 public URL is set) |
| `NODE_VERSION` | yes | `22` (netlify.toml) |
| `NETLIFY_USE_BUN` | yes | `true` (netlify.toml) |
| `NEXT_VERSION` | yes | `16` (netlify.toml) |

**CRITICAL.** Server-only secrets (`DATABASE_URL`, `JWT_SECRET`,
`STORAGE_SECRET_KEY`, etc.) MUST NOT be set on Netlify — they belong on
Render. Netlify env vars are embedded in the client bundle and would
expose secrets to anyone with browser devtools.

---

## 11. Troubleshooting

### 11.1 Worker exits with code 1 on startup

The structured JSON health report at boot lists every dependency's
status. Common failures:

- `redis: false` — `REDIS_URL` env var missing or unreachable. Check
  Render's `vidiaforge-redis` resource is provisioned + the connection
  string is auto-injected.
- `database: false` — `DATABASE_URL` missing or unreachable. Check
  Render's `vidiaforge-db` resource + IP allow list (Render internal
  services should be allowed).
- `storage: false` — for `STORAGE_PROVIDER=local`, the `UPLOAD_DIR`
  doesn't exist + can't be created. For `STORAGE_PROVIDER=s3/r2`,
  `STORAGE_BUCKET` / `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` is
  missing.
- `ffmpeg: false` — should NEVER happen with the official
  `worker.Dockerfile` (build-time assertion `RUN ffmpeg -version`). If
  it does, your Docker build cached a broken Alpine package mirror —
  rebuild with `--no-cache`.
- `ffprobe: false` — same as ffmpeg.

### 11.2 Render jobs stuck at "queued"

Symptom: `POST /api/render` returns 201 `{ queued: true, queueJobId: ... }`
but the render job's `status` stays `"queued"` indefinitely.

Causes:

1. Worker is not running → check Render worker logs for `VIDIAFORGE WORKER READY`.
2. Worker is running but `REDIS_URL` doesn't match between API + worker
   → both must point to the same Render `vidiaforge-redis` resource.
3. Worker BullMQ concurrency is 0 → check `WORKER_CONCURRENCY` env var
   (defaults to 2 if unset; must be a positive integer).

### 11.3 Render jobs stuck at "processing" with low progress

Symptom: render job's `progress` stays at 0.1 (the initial encoding
progress) forever.

Cause: FFmpeg child process is hanging. The worker polls cancellation
every 5s but doesn't time out long-running renders. To kill the job:

```bash
curl -X POST https://vidiaforge-api.onrender.com/api/render/<job-id>/cancel \
  -b cookies.txt
```

This sets `status = "cancelled"` in the DB; the worker's cancellation
polling detects this within 5s and calls `abort.abort()`, which kills
the FFmpeg child process via `proc.kill('SIGTERM')`.

### 11.4 Render output validation failed

The `FFmpegRenderService.validateRenderOutput()` runs 7 checks after
FFmpeg exit. If any fails, the job is marked `failed` with an error
message listing which check failed:

- `Output file does not exist` — FFmpeg exited 0 but didn't write the
  file. Check the FFmpeg args (likely a `-filter_complex` typo).
- `Output file is empty` — FFmpeg produced 0 bytes. Check the source
  asset is reachable in storage.
- `ffprobe could not decode output` — corrupted output. Re-run.
- `No video stream found` — FFmpeg's `-map "[vout]"` pointed at a
  dead-end filter chain. Inspect the filter graph.
- `No audio stream found` (warning only) — silent renders are valid
  but unusual. Verify the project's audio tracks are enabled.
- `Duration mismatch` — output is significantly shorter/longer than
  the project duration. Check `sourceEnd` on each clip.
- `Resolution mismatch` — output height doesn't match `options.height`
  within 1px. Check the OutputNode in the filter graph.
- `Codec mismatch` — output codec doesn't match `options.codec`. Check
  the `-c:v` flag.

### 11.5 E2E test fails

The E2E test (`tests/e2e/upload-render-download.spec.ts`) is
`test.skipIf(!process.env.E2E_API_URL)`. To run it:

```bash
E2E_API_URL=https://vidiaforge-api.onrender.com bun run test:e2e
```

It exercises the full flow: register → create project → upload → wait
for `status=ready` → add to timeline → POST /api/render → wait for
`status=completed` → download output → run ffprobe on the output.

If it fails, check the API + worker logs for the specific request IDs.

---

## 12. Rollback

To roll back a deployment:

1. Render dashboard → vidiaforge-api → Manual Deploy → Deploy previous
   commit
2. Render dashboard → vidiaforge-worker → Manual Deploy → Deploy previous
   commit
3. Netlify dashboard → Deploys → Roll back to previous deploy

If a Prisma migration needs rolling back, use `bunx prisma migrate
resolve --rolled-back <migration_name>` (Render shell). The
`prisma/migrations/` directory is committed; check the git log to find
which migration to roll back.

---

## 13. Cost estimate (Starter plan)

| Service | Plan | Monthly cost |
|---|---|---|
| Netlify | Starter | $0 (free tier) |
| Render vidiaforge-api | Starter | $7 |
| Render vidiaforge-worker | Standard | $25 |
| Render vidiaforge-db (PostgreSQL) | Starter | $7 |
| Render vidiaforge-redis | Starter | $7 |
| Cloudflare R2 | Free tier | $0 (10 GB storage free, zero egress) |
| **Total** | | **$46/mo** |

For production load, upgrade to:

| Service | Plan | Monthly cost |
|---|---|---|
| Render vidiaforge-api | Standard | $25 |
| Render vidiaforge-worker | Standard+ | $25-85 |
| Render vidiaforge-db (PostgreSQL) | Standard | $20 |
| Render vidiaforge-redis | Standard | $15 |
| **Total** | | **$85-145/mo** |
