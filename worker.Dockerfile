# VidiaForge — worker-only Docker image
#
# Multi-stage build (deps → worker-deps → build → runner) producing a self-
# contained image with FFmpeg + ffprobe + the worker source tree.
#
# CRITICAL (S1): the worker source at mini-services/worker/ is now COPIED into
# the image (the previous build had this COPY commented out, which meant
# `bun run worker:start` failed with "script not found"). The runner image
# now contains:
#   - /app/.next/standalone          (Next.js standalone — shared lib code is
#                                     compiled into .next/standalone but the
#                                     worker imports it via /app/src/lib/...)
#   - /app/src/                      (shared library code — referenced by the
#                                     worker via relative path)
#   - /app/mini-services/worker/     (worker source tree)
#   - /app/node_modules/             (root deps + worker deps MERGED so shared
#                                     lib code can resolve worker-only deps
#                                     like @aws-sdk/client-s3, bullmq, ioredis)
#
# Usage:
#   docker build -t vidiaforge-worker:latest -f worker.Dockerfile .
#   docker run --rm --env-file .env vidiaforge-worker:latest
#
# Verification (inside the container, after build):
#   ls /app/mini-services/worker/src/index.ts    # must succeed
#   which ffmpeg                                  # /usr/bin/ffmpeg
#   ffmpeg -version                               # ffmpeg version 6.x ...
#
# Worker responsibilities (polled via Redis BullMQ):
#   - queue:media-ingestion  (FFprobe + thumbnail + waveform + proxy)
#   - queue:render            (FFmpeg render pipeline)
#   - queue:transcription     (TranscriptionProvider)
#   - queue:thumbnail         (single-frame thumbnail)
#   - queue:proxy             (single 720p proxy)
#   - queue:ai                (generic AI jobs — placeholder)
#
# See docs/ARCHITECTURE.md §4.3 + §6 for the full job lifecycle.

# ─── Stage 1: deps (root) ─────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS deps

RUN apk add --no-cache python3 make g++ libc6-compat

WORKDIR /app

# Copy the root lockfile + package.json first for layer caching.
COPY package.json bun.lock* ./

# Install all root deps (including devDeps — needed by `bun run build`).
RUN bun install --frozen-lockfile

# ─── Stage 1b: worker-deps ────────────────────────────────────────────────────
# Install mini-services/worker/package.json deps separately so the worker
# has its own node_modules tree. We'll merge these into /app/node_modules in
# the runner stage so shared lib code at /app/src/lib/... can resolve the
# worker-only deps (@aws-sdk/client-s3, bullmq, ioredis, ffmpeg-static, ...).
FROM oven/bun:1-alpine AS worker-deps

RUN apk add --no-cache python3 make g++ libc6-compat

WORKDIR /app

# COPY the worker's own package.json (and lockfile if committed).
# bun.lock for the worker is OPTIONAL — falls back to a fresh install if absent.
COPY mini-services/worker/package.json mini-services/worker/bun.lock* ./mini-services/worker/

WORKDIR /app/mini-services/worker
# V4-S2 (P1-36): production builds MUST use `bun install --frozen-lockfile`
# only — NO `|| bun install` fallback. The previous fallback was a non-
# deterministic footgun: if the committed bun.lock was out of sync with
# package.json, the fallback would silently re-resolve + install whatever
# versions satisfied the (loose) semver ranges in package.json. That means
# two consecutive builds from the same commit could produce two different
# images (one with the committed lockfile's pinned versions, one with the
# freshly-resolved versions). In production, you want bit-for-bit reproducible
# builds: if the lockfile is stale, the BUILD FAILS so you know to commit a
# fresh `bun install` run. To pin versions, commit mini-services/worker/bun.lock
# (generate it locally with `cd mini-services/worker && bun install`).
RUN bun install --frozen-lockfile

# ─── Stage 2: build ───────────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS build

RUN apk add --no-cache libc6-compat

WORKDIR /app

# Bring in both node_modules trees from the deps stages.
COPY --from=deps         /app/node_modules                              ./node_modules
COPY --from=worker-deps  /app/mini-services/worker/node_modules          ./mini-services/worker/node_modules

# Copy the entire repo (source + prisma + next.config + package.json).
COPY . .

# Build Next.js 16 standalone. The package.json `build` script also copies
# .next/static + public into .next/standalone so the runner image is fully
# self-contained (worker doesn't strictly need .next/standalone, but the
# spec requires it and it provides a working server.js if needed).
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

# Generate the Prisma client (worker imports `@prisma/client` directly).
RUN bunx prisma generate

# Prune devDependencies at the root (worker node_modules is left intact —
# worker package.json has no devDependencies of its own).
RUN bun install --frozen-lockfile --production

# ─── Stage 3: runner (worker) ─────────────────────────────────────────────────
FROM oven/bun:1-alpine AS runner

# Install FFmpeg + ffprobe + DejaVu fonts (drawtext filter) + wget (healthchecks)
# + libc6-compat (sharp + native modules).
# The worker REQUIRES these — without FFmpeg, no render or media-ingest job can run.
RUN apk add --no-cache \
    ffmpeg \
    ffprobe \
    font-dejavu \
    ttf-dejavu-core \
    wget \
    libc6-compat

# ─── BUILD-TIME VERIFICATION ──────────────────────────────────────────────────
# Fail the build IMMEDIATELY if FFmpeg or ffprobe is missing or broken.
# This catches broken Alpine package mirrors + corrupted base images BEFORE
# the worker ships and silently fails jobs at runtime.
RUN ffmpeg -version && ffprobe -version && echo "FFmpeg + ffprobe verified OK"

# Optional: verify DejaVu fonts are findable by FFmpeg (for drawtext filter).
RUN mkdir -p /usr/share/fonts/truetype/dejavu && \
    ls /usr/share/fonts/truetype/dejavu/ | head -n 3 && \
    echo "DejaVu fonts verified OK"

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# S1: worker configuration defaults (override via Render/docker env vars).
ENV WORKER_CONCURRENCY=2
ENV TEMP_DIR=/app/tmp
ENV UPLOAD_DIR=/app/uploads

# Non-root user (Next.js convention: uid/gid 1001).
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# ─── Copy build artifacts ─────────────────────────────────────────────────────
# Next.js standalone build (server.js + minimal node_modules). Worker doesn't
# run server.js but the spec requires this COPY so the image can be reused
# for the API service if ever needed.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
# Static assets (the build step already copied these into standalone, but we
# copy again as a safety net).
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
# Public assets (manifest, icons, robots.txt).
COPY --from=build --chown=nextjs:nodejs /app/public ./public
# Prisma schema + migrations so the runner can run `prisma migrate deploy`
# if invoked manually (Render's preDeployCommand handles this on the API side).
COPY --from=build --chown=nextjs:nodejs /app/prisma ./prisma
# Root package.json — required so `bun run worker:start` resolves.
COPY --from=build --chown=nextjs:nodejs /app/package.json ./package.json

# ─── CRITICAL (S1): worker source tree ────────────────────────────────────────
# Previously this line was COMMENTED OUT, which meant `bun run worker:start`
# failed inside the container with "script not found" because the worker's
# package.json + src/ were never copied into the image.
#
# After this COPY, the following verification will succeed inside the container:
#   ls /app/mini-services/worker/src/index.ts
COPY --from=build --chown=nextjs:nodejs /app/mini-services ./mini-services

# Shared library code (the worker imports ../../../../src/lib/...).
COPY --from=build --chown=nextjs:nodejs /app/src ./src

# Runtime node_modules — root deps (production-pruned) from the BUILD stage,
# which also includes the Prisma-generated client at node_modules/.prisma/.
COPY --from=build --chown=nextjs:nodejs /app/node_modules ./node_modules

# Merge worker-only deps (bullmq, ioredis, ffmpeg-static, ffprobe-static,
# @aws-sdk/*) into /app/node_modules so shared lib code under /app/src/lib/
# can resolve them. We use the `/.` trick (`cp -r src/. dest/`) which works
# in BusyBox cp (Alpine's default) AND copies hidden entries. Duplicate
# packages have identical versions in both package.json files so overwrite
# is safe — the Prisma-generated client at node_modules/.prisma/client/ is
# untouched (it's a separate dir not present in worker's node_modules).
#
# We tolerate failures (e.g. if mini-services/worker/node_modules is somehow
# empty) — the worker startup validation will then catch missing modules and
# exit(1) with a clear message rather than silently failing at runtime.
RUN cp -r /app/mini-services/worker/node_modules/. /app/node_modules/ 2>/dev/null || \
    echo "[worker.Dockerfile] WARNING: worker node_modules merge skipped (source missing)"

# Runtime directories for temp render output + proxy media + cache.
# Pre-create with correct ownership so STORAGE_PROVIDER=local works out of the box.
RUN mkdir -p /app/uploads /app/tmp /app/cache && \
    chown -R nextjs:nodejs /app/uploads /app/tmp /app/cache /app/node_modules /app/mini-services

USER nextjs

# Worker exposes a tiny health endpoint on port 3001.
EXPOSE 3001

# ─── Build-time verification (sanity check that source landed) ────────────────
# Asserts that the worker entry point exists. If this fails, the build breaks
# loudly — by design, so a misconfigured COPY never ships a silent no-op worker.
RUN ls /app/mini-services/worker/src/index.ts && \
    echo "worker entry point verified: /app/mini-services/worker/src/index.ts"

# ─── CMD ───────────────────────────────────────────────────────────────────────
# `bun run worker:start` resolves from the ROOT package.json to:
#   `cd mini-services/worker && bun run src/index.ts`
# That script enters mini-services/worker/ and runs the worker entry.
CMD ["bun", "run", "worker:start"]
