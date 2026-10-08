# VidiaForge — production Docker image
#
# Multi-stage build (deps → build → runner) based on oven/bun:1-alpine for
# runtime consistency with the dev environment (Bun is used in package.json
# scripts). The runner image also installs FFmpeg + ffprobe + DejaVu fonts
# so the same image can be used as either the Next.js API server (default
# CMD) or the FFmpeg render worker (override CMD via worker.Dockerfile).
#
# Usage:
#   docker build -t vidiaforge:latest .
#   docker run --rm -p 3000:3000 --env-file .env vidiaforge:latest
#
# Health check:
#   GET /api/health returns 200 { status: "ok", db: "connected" }
#   The Docker HEALTHCHECK polls this endpoint every 30s.

# ─── Stage 1: deps ────────────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS deps

# Install build-time OS deps for native modules (e.g. sharp).
# sharp ships prebuilt binaries for Alpine, so we don't need libvips here,
# but we keep build-base for safety.
RUN apk add --no-cache python3 make g++ libc6-compat

WORKDIR /app

# Copy lockfile + package.json first for better layer caching.
COPY package.json bun.lock* ./

# Install all dependencies (including devDeps for the build step).
#
# V4-S2 (P1-36): production builds MUST use `bun install --frozen-lockfile`
# only — NO `|| bun install` fallback (which would silently re-resolve + install
# whatever versions satisfied the loose semver ranges in package.json, breaking
# bit-for-bit build reproducibility). If the committed bun.lock is out of sync
# with package.json, the BUILD FAILS — that's the correct behavior (commit a
# fresh `bun install` run locally).
RUN bun install --frozen-lockfile

# ─── Stage 2: build ───────────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS build

# Install OS deps needed only at build time (none beyond what deps has).
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Copy installed deps from the previous stage.
COPY --from=deps /app/node_modules ./node_modules

# Copy the rest of the source.
COPY . .

# Build Next.js 16 standalone. The `next build` step produces .next/standalone
# (server + minimal node_modules). The package.json scripts.build also copies
# .next/static and public/ into .next/standalone/ so the runner image is
# fully self-contained.
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

# Prune devDependencies — we only need production deps in the runner.
RUN bun install --frozen-lockfile --production

# ─── Stage 3: runner ──────────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS runner

# Install FFmpeg + ffprobe + DejaVu fonts (for the render worker + text overlays).
# These add ~80 MB to the image but are required for the worker.
RUN apk add --no-cache \
    ffmpeg \
    ffprobe \
    font-dejavu \
    ttf-dejavu-core \
    wget \
    libc6-compat

WORKDIR /app

# Set NODE_ENV so Next.js + Prisma behave as production.
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Create a non-root user for security.
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy the standalone Next.js server (from .next/standalone).
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
# Copy static assets (the build step already copied these into standalone,
# but we copy again as a safety net).
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
# Copy public assets (manifest, icons, robots.txt).
COPY --from=build --chown=nextjs:nodejs /app/public ./public
# Copy Prisma schema + migrations so the runner can run `prisma migrate deploy`.
COPY --from=build --chown=nextjs:nodejs /app/prisma ./prisma
# Copy package.json so `bun run worker:start` resolves.
COPY --from=build --chown=nextjs:nodejs /app/package.json ./package.json
# Copy the worker entry point (architecture-ready — mini-services/worker/).
# If this directory doesn't exist yet, the COPY will fail; until the worker
# source is added, the default CMD below (node server.js) still works.
# COPY --from=build --chown=nextjs:nodejs /app/mini-services ./mini-services

# Create runtime directories for local storage fallback (when STORAGE_PROVIDER=local).
RUN mkdir -p /app/uploads /app/tmp /app/cache && \
    chown -R nextjs:nodejs /app/uploads /app/tmp /app/cache

# Switch to the non-root user.
USER nextjs

# Expose the Next.js standalone server port.
EXPOSE 3000

# Health check: GET /api/health every 30s, 3 consecutive failures = unhealthy.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Default command: run the Next.js standalone server.
# The worker.Dockerfile overrides this with `bun run worker:start`.
# Note: we use `node` (not `bun`) here because Next.js standalone produces a
# Node-compatible server.js — Bun also works, but Node is the conservative
# choice for production stability.
CMD ["node", "server.js"]
