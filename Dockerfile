
# VidiaForge — production Docker image
#
# Multi-stage build: deps -> build -> runner.
# Next.js standalone runtime, Prisma migrations, FFmpeg and non-root execution.

# ─── Stage 1: dependencies ───────────────────────────────────────────────────

FROM oven/bun:1.3.14-alpine AS deps

RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    libc6-compat

WORKDIR /app

COPY package.json bun.lock* ./

# Use the committed lockfile; fail if dependencies are inconsistent.
RUN bun install --frozen-lockfile


# ─── Stage 2: application build ──────────────────────────────────────────────

FROM oven/bun:1.3.14-alpine AS build

RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate the Prisma Client before the Next.js build.
RUN bunx prisma generate

ENV NEXT_TELEMETRY_DISABLED=1

# Build the Next.js standalone application.
RUN bun run build

# Prune development dependencies while retaining production dependencies.
# In this project, "prisma" and "@prisma/client" are dependencies.
RUN bun install --frozen-lockfile --production


# ─── Stage 3: production runner ─────────────────────────────────────────────

FROM oven/bun:1.3.14-alpine AS runner

RUN apk add --no-cache \
    ffmpeg \
    font-dejavu \
    wget \
    libc6-compat

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Create the non-root application user.
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Next.js standalone server and its traced dependencies.
COPY --from=build \
    --chown=nextjs:nodejs \
    /app/.next/standalone \
    ./

# Include the production dependency tree. This is essential because the
# standalone output alone does not guarantee that the Prisma CLI is present.
COPY --from=build \
    --chown=nextjs:nodejs \
    /app/node_modules \
    ./node_modules

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

# Prisma schema and migration history.
COPY --from=build \
    --chown=nextjs:nodejs \
    /app/prisma \
    ./prisma

# Runtime package scripts and metadata.
COPY --from=build \
    --chown=nextjs:nodejs \
    /app/package.json \
    ./package.json

# Fail the image build if required runtime executables are missing.
RUN test -x /app/node_modules/.bin/prisma && \
    test -f /app/server.js && \
    test -f /app/prisma/schema.prisma

# Runtime directories for temporary files and local-storage fallback.
RUN mkdir -p /app/uploads /app/tmp /app/cache && \
    chown -R nextjs:nodejs /app/uploads /app/tmp /app/cache

USER nextjs

EXPOSE 3000

# Container health check.
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

# Run the locally installed Prisma CLI, then start Next.js.
# A migration failure stops startup instead of hiding the failure.
CMD ["/bin/sh", "-c", "./node_modules/.bin/prisma migrate deploy && exec node server.js"]
