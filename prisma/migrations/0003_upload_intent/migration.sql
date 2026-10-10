-- V4-S1 migration: UploadIntent table.
--
-- Closes a critical P0 security hole in the upload pipeline: previously the
-- finalize endpoint accepted arbitrary storage keys from the client, so any
-- authenticated user could claim ownership of any S3 object by sending its key.
--
-- The UploadIntent row is created when the user initiates an upload
-- (POST /api/assets/upload) and stores: the storageKey (which is randomly
-- generated server-side), expectedSize, expectedMime, userId, projectId, and
-- an expiresAt timestamp. The finalize endpoint (POST /api/assets/finalize)
-- takes ONLY the uploadIntentId — never an arbitrary key — and verifies:
--   (a) intent.userId === session user (ownership),
--   (b) intent.expiresAt > now,
--   (c) intent.status is 'created' or 'uploaded' (not already finalized),
--   (d) the object actually exists in storage via storage.headObject(),
--   (e) actualSize === Number(intent.expectedSize) (exact match — no tolerance).
--
-- Status transitions: created → (uploaded for local multipart) → finalized.
-- Idempotency: if intent.status === 'finalized', the existing MediaAsset is
-- returned rather than creating a duplicate.
--
-- storageKey is UNIQUE because each intent corresponds to exactly one storage
-- object; a second intent for the same key would imply a stale/replayed upload.
-- expectedSize is BIGINT to match UsageRecord.storageBytesUsed (Prisma BigInt
-- → PostgreSQL bigint — INTEGER caps at ~2GB, too small for 500MB uploads if
-- we later add other size aggregations).

CREATE TABLE "UploadIntent" (
    "id"            TEXT NOT NULL,
    "userId"        TEXT NOT NULL,
    "projectId"     TEXT NOT NULL,
    "storageKey"    TEXT NOT NULL,
    "filename"      TEXT NOT NULL,
    "expectedSize"  BIGINT NOT NULL,
    "expectedMime"  TEXT NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'created',
    "expiresAt"     TIMESTAMP(3) NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt"   TIMESTAMP(3)
);

CREATE UNIQUE INDEX "UploadIntent_storageKey_key" ON "UploadIntent"("storageKey");
CREATE INDEX "UploadIntent_userId_idx"            ON "UploadIntent"("userId");
CREATE INDEX "UploadIntent_projectId_idx"          ON "UploadIntent"("projectId");
CREATE INDEX "UploadIntent_expiresAt_idx"          ON "UploadIntent"("expiresAt");

ALTER TABLE "UploadIntent" ADD CONSTRAINT "UploadIntent_pkey" PRIMARY KEY ("id");

ALTER TABLE "UploadIntent"
    ADD CONSTRAINT "UploadIntent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UploadIntent"
    ADD CONSTRAINT "UploadIntent_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
