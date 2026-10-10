-- VidiaForge — initial PostgreSQL schema migration (0001_initial)
--
-- Generated manually (sandbox has no real PostgreSQL) by translating
-- prisma/schema.prisma to PostgreSQL DDL. Matches the format that
-- `prisma migrate dev --name init` would produce, so `prisma migrate deploy`
-- will accept this migration as the baseline.
--
-- Provider: postgresql (see migration_lock.toml)
--
-- Tables are created in dependency order: independent first, dependents after.
-- Self-referential FKs (MediaAsset.proxyAssetId) are added last so the
-- referenced table exists before the constraint is created.

-- ─────────────────────────────────────────────────────────────────────────────
-- Extensions
-- ─────────────────────────────────────────────────────────────────────────────
-- Prisma migrations always declare this extension (harmless if it already exists)
-- even though we use cuid() at the app layer (no gen_random_uuid() calls in DDL).
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- "User"
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "User" (
    "id"            TEXT NOT NULL,
    "email"         TEXT NOT NULL,
    "name"          TEXT,
    "passwordHash"  TEXT,
    "avatarUrl"     TEXT,
    "plan"          TEXT NOT NULL DEFAULT 'free',
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

ALTER TABLE "User" ADD CONSTRAINT "User_pkey" PRIMARY KEY ("id");

-- ─────────────────────────────────────────────────────────────────────────────
-- "Session"
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "Session" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "token"     TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

CREATE INDEX "Session_userId_idx" ON "Session"("userId");

ALTER TABLE "Session" ADD CONSTRAINT "Session_pkey" PRIMARY KEY ("id");

ALTER TABLE "Session"
    ADD CONSTRAINT "Session_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- "Project"
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "Project" (
    "id"            TEXT NOT NULL,
    "userId"        TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "description"   TEXT,
    "width"         INTEGER NOT NULL DEFAULT 1920,
    "height"        INTEGER NOT NULL DEFAULT 1080,
    "fps"           INTEGER NOT NULL DEFAULT 30,
    "canvasPreset"  TEXT NOT NULL DEFAULT '16:9',
    "resolution"    TEXT NOT NULL DEFAULT '1080p',
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "timelineData"  TEXT NOT NULL DEFAULT '{}',
    "duration"      DOUBLE PRECISION NOT NULL DEFAULT 0,
    "thumbnailUrl"  TEXT,
    "favorite"      BOOLEAN NOT NULL DEFAULT false,
    "lastSnapshot"  TEXT,
    "lastSavedAt"   TIMESTAMP(3),
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastOpenedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "Project_userId_idx" ON "Project"("userId");

ALTER TABLE "Project" ADD CONSTRAINT "Project_pkey" PRIMARY KEY ("id");

ALTER TABLE "Project"
    ADD CONSTRAINT "Project_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- "ProjectVersion"
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "ProjectVersion" (
    "id"        TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "label"     TEXT,
    "snapshot"  TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "ProjectVersion_projectId_idx" ON "ProjectVersion"("projectId");

ALTER TABLE "ProjectVersion" ADD CONSTRAINT "ProjectVersion_pkey" PRIMARY KEY ("id");

ALTER TABLE "ProjectVersion"
    ADD CONSTRAINT "ProjectVersion_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- "MediaAsset"
-- Includes S1 additions: status, errorMessage, failedAt, proxyAssetId
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "MediaAsset" (
    "id"            TEXT NOT NULL,
    "userId"        TEXT NOT NULL,
    "projectId"     TEXT,
    "filename"      TEXT NOT NULL,
    "internalName"  TEXT NOT NULL,
    "mimeType"      TEXT NOT NULL,
    "size"          INTEGER NOT NULL,
    "storagePath"   TEXT NOT NULL,
    "kind"          TEXT NOT NULL,
    "duration"      DOUBLE PRECISION,
    "width"         INTEGER,
    "height"        INTEGER,
    "fps"           DOUBLE PRECISION,
    "codec"         TEXT,
    "audioChannels" INTEGER,
    "thumbnailUrl"  TEXT,
    "waveformUrl"   TEXT,
    -- S1 ingestion status tracking
    "status"        TEXT NOT NULL DEFAULT 'uploading',
    "errorMessage"  TEXT,
    "failedAt"      TIMESTAMP(3),
    -- S1 proxy self-reference (nullable)
    "proxyAssetId"  TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "MediaAsset_userId_idx"      ON "MediaAsset"("userId");
CREATE INDEX "MediaAsset_projectId_idx"   ON "MediaAsset"("projectId");
CREATE INDEX "MediaAsset_status_idx"      ON "MediaAsset"("status");
CREATE INDEX "MediaAsset_proxyAssetId_idx" ON "MediaAsset"("proxyAssetId");

ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id");

ALTER TABLE "MediaAsset"
    ADD CONSTRAINT "MediaAsset_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MediaAsset"
    ADD CONSTRAINT "MediaAsset_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Self-reference added LAST so the referenced table + PK exist.
ALTER TABLE "MediaAsset"
    ADD CONSTRAINT "MediaAsset_proxyAssetId_fkey"
    FOREIGN KEY ("proxyAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- "RenderJob"
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "RenderJob" (
    "id"          TEXT NOT NULL,
    "projectId"   TEXT NOT NULL,
    "status"      TEXT NOT NULL DEFAULT 'queued',
    "format"      TEXT NOT NULL DEFAULT 'mp4',
    "codec"       TEXT NOT NULL DEFAULT 'h264',
    "resolution"  TEXT NOT NULL DEFAULT '1080p',
    "fps"         INTEGER NOT NULL DEFAULT 30,
    "bitrate"     TEXT NOT NULL DEFAULT 'medium',
    "progress"    DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stage"       TEXT,
    "outputUrl"   TEXT,
    "error"       TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt"   TIMESTAMP(3),
    "completedAt" TIMESTAMP(3)
);

CREATE INDEX "RenderJob_projectId_idx" ON "RenderJob"("projectId");

ALTER TABLE "RenderJob" ADD CONSTRAINT "RenderJob_pkey" PRIMARY KEY ("id");

ALTER TABLE "RenderJob"
    ADD CONSTRAINT "RenderJob_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- "AIJob" — no FKs (userId + projectId are advisory; app enforces ownership)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "AIJob" (
    "id"          TEXT NOT NULL,
    "userId"      TEXT NOT NULL,
    "projectId"   TEXT,
    "kind"        TEXT NOT NULL,
    "status"      TEXT NOT NULL DEFAULT 'queued',
    "input"       TEXT NOT NULL,
    "output"      TEXT,
    "provider"    TEXT,
    "error"       TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3)
);

CREATE INDEX "AIJob_userId_idx"    ON "AIJob"("userId");
CREATE INDEX "AIJob_projectId_idx" ON "AIJob"("projectId");

ALTER TABLE "AIJob" ADD CONSTRAINT "AIJob_pkey" PRIMARY KEY ("id");

-- ─────────────────────────────────────────────────────────────────────────────
-- "Template"
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "Template" (
    "id"           TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "category"     TEXT NOT NULL,
    "description"  TEXT,
    "thumbnailUrl" TEXT,
    "canvasPreset" TEXT NOT NULL,
    "duration"     DOUBLE PRECISION NOT NULL,
    "timelineData" TEXT NOT NULL,
    "isBuiltin"    BOOLEAN NOT NULL DEFAULT true,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "Template" ADD CONSTRAINT "Template_pkey" PRIMARY KEY ("id");

-- ─────────────────────────────────────────────────────────────────────────────
-- "UserPreferences" — userId is the PRIMARY KEY (1:1 with User)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "UserPreferences" (
    "userId"               TEXT NOT NULL,
    "theme"                TEXT NOT NULL DEFAULT 'dark',
    "timecodeFormat"       TEXT NOT NULL DEFAULT 'hhmmssff',
    "snap"                 BOOLEAN NOT NULL DEFAULT true,
    "magneticTimeline"     BOOLEAN NOT NULL DEFAULT true,
    "autoSave"             BOOLEAN NOT NULL DEFAULT true,
    "autoSaveInterval"     INTEGER NOT NULL DEFAULT 5,
    "proxyMedia"           BOOLEAN NOT NULL DEFAULT true,
    "playbackSpeed"        DOUBLE PRECISION NOT NULL DEFAULT 1,
    "defaultCanvasPreset"  TEXT NOT NULL DEFAULT '16:9',
    "defaultResolution"    TEXT NOT NULL DEFAULT '1080p',
    "defaultFps"           INTEGER NOT NULL DEFAULT 30,
    "shortcuts"            TEXT NOT NULL DEFAULT '{}',
    "brandKit"             TEXT NOT NULL DEFAULT '{}'
);

ALTER TABLE "UserPreferences" ADD CONSTRAINT "UserPreferences_pkey" PRIMARY KEY ("userId");

ALTER TABLE "UserPreferences"
    ADD CONSTRAINT "UserPreferences_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- "Subscription"
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "Subscription" (
    "id"                     TEXT NOT NULL,
    "userId"                 TEXT NOT NULL,
    "plan"                   TEXT NOT NULL,
    "status"                 TEXT NOT NULL DEFAULT 'active',
    "currentPeriodStart"     TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd"       TIMESTAMP(3),
    "cancelAtPeriodEnd"      BOOLEAN NOT NULL DEFAULT false,
    "provider"               TEXT,
    "providerSubscriptionId" TEXT,
    "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "Subscription_providerSubscriptionId_key" ON "Subscription"("providerSubscriptionId");
CREATE INDEX "Subscription_userId_idx"  ON "Subscription"("userId");
CREATE INDEX "Subscription_status_idx"  ON "Subscription"("status");

ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id");

ALTER TABLE "Subscription"
    ADD CONSTRAINT "Subscription_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- "UsageRecord" — userId is PK + composite unique(userId, month)
-- storageBytesUsed is BIGINT (Prisma BigInt → PostgreSQL bigint)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "UsageRecord" (
    "userId"            TEXT NOT NULL,
    "month"             TEXT NOT NULL,
    "aiCreditsUsed"     INTEGER NOT NULL DEFAULT 0,
    "renderSecondsUsed" INTEGER NOT NULL DEFAULT 0,
    "storageBytesUsed"  BIGINT NOT NULL DEFAULT 0,
    "projectsCreated"   INTEGER NOT NULL DEFAULT 0,
    "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "UsageRecord_month_idx" ON "UsageRecord"("month");

CREATE UNIQUE INDEX "UsageRecord_userId_month_key" ON "UsageRecord"("userId", "month");

ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("userId");

ALTER TABLE "UsageRecord"
    ADD CONSTRAINT "UsageRecord_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- "ProjectShare"
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "ProjectShare" (
    "id"         TEXT NOT NULL,
    "projectId"  TEXT NOT NULL,
    "shareToken" TEXT NOT NULL,
    "permission" TEXT NOT NULL DEFAULT 'view',
    "expiresAt"  TIMESTAMP(3),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy"  TEXT
);

CREATE UNIQUE INDEX "ProjectShare_shareToken_key" ON "ProjectShare"("shareToken");
CREATE INDEX "ProjectShare_projectId_idx"         ON "ProjectShare"("projectId");

ALTER TABLE "ProjectShare" ADD CONSTRAINT "ProjectShare_pkey" PRIMARY KEY ("id");

ALTER TABLE "ProjectShare"
    ADD CONSTRAINT "ProjectShare_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectShare"
    ADD CONSTRAINT "ProjectShare_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- "Comment"
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "Comment" (
    "id"           TEXT NOT NULL,
    "projectId"    TEXT NOT NULL,
    "clipId"       TEXT,
    "timelineTime" DOUBLE PRECISION,
    "userId"       TEXT NOT NULL,
    "body"         TEXT NOT NULL,
    "resolved"     BOOLEAN NOT NULL DEFAULT false,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "Comment_projectId_idx" ON "Comment"("projectId");
CREATE INDEX "Comment_userId_idx"    ON "Comment"("userId");
CREATE INDEX "Comment_clipId_idx"    ON "Comment"("clipId");

ALTER TABLE "Comment" ADD CONSTRAINT "Comment_pkey" PRIMARY KEY ("id");

ALTER TABLE "Comment"
    ADD CONSTRAINT "Comment_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Comment"
    ADD CONSTRAINT "Comment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
