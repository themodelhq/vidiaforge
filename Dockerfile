# VidiaForge — production Docker image
#
# Multi-stage build (deps → build → runner) based on oven/bun:1-alpine.
#
# The build stage explicitly runs `prisma generate` BEFORE the Next.js
# TypeScript/build step. This is required because @prisma/client is generated
# from prisma/schema.prisma and the application imports PrismaClient directly.
#
# Usage:
#   docker build -t vidiaforge:latest .
#   docker run --rm -p 3000:3000 --env-file .env vidiaforge:latest
#
# Health check:
#   GET /api/health returns 200 { status: "ok", db: "connected" }
#
# The runner image also contains FFmpeg, ffprobe and DejaVu fonts so the
# image can support rendering-related runtime requirements.

# ─── Stage 1: dependencies ───────────────────────────────────────────────────

FROM oven/bun:1-alpine AS deps

# Native build dependencies.
# These are required by packages such as sharp and other native modules.
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    libc6-compat

WORKDIR /app

# Copy package manifests first for Docker layer caching.
COPY package.json bun.lock* ./

# Production builds must use the committed lockfile exactly.
# Do NOT fall back to an unlocked install.
RUN bun install --frozen-lockfile


# ─── Stage 2: application build ──────────────────────────────────────────────

FROM oven/bun:1-alpine AS build

# Runtime compatibility required by some Node/Bun packages.
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Copy the fully resolved dependency tree.
COPY --from=deps /app/node_modules ./node_modules

# Copy the complete application source.
#
# This includes:
#   - prisma/schema.prisma
#   - prisma/migrations/
#   - src/
#   - mini-services/
#   - tests/
#   - package.json
#   - Next.js configuration
COPY . .

# ─────────────────────────────────────────────────────────────────────────────
# IMPORTANT: GENERATE PRISMA CLIENT BEFORE NEXT.JS/TYPESCRIPT BUILD
# ─────────────────────────────────────────────────────────────────────────────
#
# @prisma/client is installed by bun install, but PrismaClient itself is
# generated from prisma/schema.prisma.
#
# Without this step, TypeScript can fail with:
#
#   Module '"@prisma/client"' has no exported member 'PrismaClient'.
#
# This is especially important because the worker now correctly uses:
#
#   import { PrismaClient } from '@prisma/client';
#
# Generate the client explicitly and fail the Docker build if generation fails.
RUN bunx prisma generate

# Disable Next.js telemetry during production builds.
ENV NEXT_TELEMETRY_DISABLED=1

# Build Next.js standalone application.
#
# package.json build script is responsible for:
#   next build
#   copying .next/static into .next/standalone
#   copying public into .next/standalone
RUN bun run build

# ─────────────────────────────────────────────────────────────────────────────
# Production dependency pruning
# ─────────────────────────────────────────────────────────────────────────────
#
# Keep the exact committed lockfile while removing development dependencies.
RUN bun install --frozen-lockfile --production


# ─── Stage 3: production runner ──────────────────────────────────────────────

FROM oven/bun:1-alpine AS runner

# Install runtime tools required by VidiaForge.
#
# ffprobe is provided by the FFmpeg package on Alpine, so a separate
# `ffprobe` APK package is intentionally NOT requested.
RUN apk add --no-cache \
    ffmpeg \
    font-dejavu \
    wget \
    libc6-compat

WORKDIR /app

# Production runtime environment.
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# ─────────────────────────────────────────────────────────────────────────────
# Create non-root runtime user
# ─────────────────────────────────────────────────────────────────────────────

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs


# ─────────────────────────────────────────────────────────────────────────────
# Copy Next.js standalone application
# ─────────────────────────────────────────────────────────────────────────────

COPY --from=build \
    --chown=nextjs:nodejs \
    /app/.next/standalone \
    ./

# Static Next.js assets.
COPY --from=build \
    --chown=nextjs:nodejs \
    /app/.next/static \
    ./.next/static

# Public assets.
COPY --from=build \
    --chown=nextjs:nodejs \
    /app/public \
    ./public


# ─────────────────────────────────────────────────────────────────────────────
# Prisma runtime assets
# ─────────────────────────────────────────────────────────────────────────────
#
# Keep the Prisma schema and migrations available in the production image.
# Render's preDeploy command can then execute:
#
#   bun run db:generate
#   bun run db:migrate:deploy
#
# The Prisma Client itself was already generated in the build stage.
COPY --from=build \
    --chown=nextjs:nodejs \
    /app/prisma \
    ./prisma

# package.json is required by runtime scripts such as worker:start and
# database migration commands.
COPY --from=build \
    --chown=nextjs:nodejs \
    /app/package.json \
    ./package.json


# ─────────────────────────────────────────────────────────────────────────────
# Runtime directories
# ─────────────────────────────────────────────────────────────────────────────
#
# These directories support the local-storage fallback and temporary
# processing when STORAGE_PROVIDER=local.
#
# Production deployments should normally use S3/R2 rather than local storage.
RUN mkdir -p \
    /app/uploads \
    /app/tmp \
    /app/cache && \
    chown -R nextjs:nodejs \
    /app/uploads \
    /app/tmp \
    /app/cache


# ─────────────────────────────────────────────────────────────────────────────
# Security: never run the application as root
# ─────────────────────────────────────────────────────────────────────────────

USER nextjs


# ─────────────────────────────────────────────────────────────────────────────
# Network
# ─────────────────────────────────────────────────────────────────────────────

EXPOSE 3000


# ─────────────────────────────────────────────────────────────────────────────
# Container health check
# ─────────────────────────────────────────────────────────────────────────────
#
# /api/health must remain a lightweight endpoint that does not require
# authentication.
#
# Render will also have its own service-level health check configured through
# render.yaml.
HEALTHCHECK \
    --interval=30s \
    --timeout=10s \
    --start-period=40s \
    --retries=3 \
    CMD wget \
        --no-verbose \
        --tries=1 \
        --spider \
        http://localhost:3000/api/health \
        || exit 1


# ─────────────────────────────────────────────────────────────────────────────
# Default production command
# ─────────────────────────────────────────────────────────────────────────────
#
# Next.js standalone produces a Node-compatible server.js.
# Node is intentionally used here rather than Bun for conservative
# production runtime compatibility.
#
# The worker.Dockerfile can override the command for the FFmpeg worker.
CMD ["/bin/sh", "-c", "bunx --package prisma@6.19.2 prisma migrate resolve --rolled-back 0005_usage_record_composite_pk && bunx --package prisma@6.19.2 prisma migrate deploy && exec node server.js"]