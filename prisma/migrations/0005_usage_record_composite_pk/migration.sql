-- V9 Production Hardening: UsageRecord composite PK — DATA-PRESERVING migration.
--
-- PROBLEM (v9 §4): The v7 migration used `array_agg(a.attname ORDER BY ...)`
-- inside a subquery that correlated pg_index + pg_attribute. This is invalid
-- PostgreSQL syntax (array_agg requires GROUP BY when combined with non-aggregated
-- columns in the same SELECT level). The migration would fail on databases
-- with existing indexes.
--
-- FIX (v9 §4.2): Use valid PostgreSQL catalog queries. Check:
--   1. pg_constraint for table-level UNIQUE constraints
--   2. pg_class + pg_index for standalone unique indexes by NAME
--   3. If either exists, DO NOT create a duplicate
--
-- Safe for: fresh DB, v4 DB (no id column), v7/v8 DB (already migrated),
-- databases with existing unique index, databases with duplicate data (fails safely).

-- ─── Step 1: Create table if it doesn't exist (fresh database) ─────────────
CREATE TABLE IF NOT EXISTS "UsageRecord" (
    "id"                TEXT NOT NULL,
    "userId"            TEXT NOT NULL,
    "month"             TEXT NOT NULL,
    "aiCreditsUsed"     INTEGER NOT NULL DEFAULT 0,
    "renderSecondsUsed" INTEGER NOT NULL DEFAULT 0,
    "storageBytesUsed"  BIGINT NOT NULL DEFAULT 0,
    "projectsCreated"   INTEGER NOT NULL DEFAULT 0,
    "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ─── Step 2: If `id` column doesn't exist yet (v4 schema), ADD it ──────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'UsageRecord' AND column_name = 'id'
    ) THEN
        ALTER TABLE "UsageRecord" ADD COLUMN "id" TEXT;
    END IF;
END $$;

-- ─── Step 3: Backfill NULL ids with gen_random_uuid() ──────────────────────
UPDATE "UsageRecord"
SET "id" = REPLACE(gen_random_uuid()::text, '-', '')
WHERE "id" IS NULL OR "id" = '';

-- ─── Step 4: Set `id` NOT NULL ─────────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'UsageRecord' AND column_name = 'id'
        AND is_nullable = 'YES'
    ) THEN
        ALTER TABLE "UsageRecord" ALTER COLUMN "id" SET NOT NULL;
    END IF;
END $$;

-- ─── Step 5: Drop old primary key constraint on `userId` if it exists ──────
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_index i
        JOIN pg_attribute a
          ON a.attrelid = i.indrelid
         AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = '"UsageRecord"'::regclass
          AND i.indisprimary
          AND a.attname = 'userId'
    ) THEN
        EXECUTE format(
            'ALTER TABLE "UsageRecord" DROP CONSTRAINT %I',
            (
                SELECT conname
                FROM pg_constraint
                WHERE contype = 'p'
                  AND conrelid = '"UsageRecord"'::regclass
                LIMIT 1
            )
        );
    END IF;
END $$;

-- ─── Step 6: Add new primary key on `id` if it doesn't exist ──────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'UsageRecord_pkey'
        AND contype = 'p'
        AND conrelid = '"UsageRecord"'::regclass
    ) THEN
        ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id");
    END IF;
END $$;

-- ─── Step 7: Add unique constraint on (userId, month) ──────────────────────
-- V12.1 §40-41: Detect equivalent unique indexes by COLUMNS, not just name.
-- The old code checked for a constraint/index named 'UsageRecord_userId_month_key'
-- but a database might have an equivalent index with a different name (e.g.
-- 'usage_record_user_month_unique'). We now check for ANY unique index on
-- (userId, month) regardless of its name.
DO $$
BEGIN
    -- Check 1: Is there a named UNIQUE constraint?
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'UsageRecord_userId_month_key'
        AND contype = 'u'
        AND conrelid = '"UsageRecord"'::regclass
    )
    -- Check 2: Is there a named unique index with this exact name?
    AND NOT EXISTS (
        SELECT 1
        FROM pg_class idx
        JOIN pg_index ix ON ix.indexrelid = idx.oid
        WHERE ix.indrelid = '"UsageRecord"'::regclass
          AND ix.indisunique
          AND idx.relname = 'UsageRecord_userId_month_key'
    )
    -- V12.1 §41: Check 3 — is there ANY unique index on exactly (userId, month)
    -- regardless of its name? This detects equivalent indexes created by
    -- different migration tools or manual DBA operations.
    AND NOT EXISTS (
        SELECT 1
        FROM pg_index ix
        JOIN pg_class c ON c.oid = ix.indrelid
        WHERE c.relname = 'UsageRecord'
          AND ix.indisunique
          AND ix.indnatts = 2  -- exactly 2 columns
          -- Verify the indexed columns are (userId, month) in order
          AND EXISTS (
            SELECT 1
            FROM pg_attribute a1
            WHERE a1.attrelid = ix.indrelid
              AND a1.attnum = ix.indkey[0]
              AND a1.attname = 'userId'
          )
          AND EXISTS (
            SELECT 1
            FROM pg_attribute a2
            WHERE a2.attrelid = ix.indrelid
              AND a2.attnum = ix.indkey[1]
              AND a2.attname = 'month'
          )
    ) THEN
        -- V12.1 §42: If duplicate (userId, month) rows exist, this FAILS SAFELY
        -- with a unique violation error. No data is deleted.
        ALTER TABLE "UsageRecord"
          ADD CONSTRAINT "UsageRecord_userId_month_key"
          UNIQUE ("userId", "month");
    END IF;
END $$;

-- ─── Step 8: Add indexes if they don't exist ───────────────────────────────
CREATE INDEX IF NOT EXISTS "UsageRecord_userId_idx" ON "UsageRecord"("userId");
CREATE INDEX IF NOT EXISTS "UsageRecord_month_idx" ON "UsageRecord"("month");

-- ─── Step 9: Add foreign key constraint if it doesn't exist ────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'UsageRecord_userId_fkey'
        AND contype = 'f'
        AND conrelid = '"UsageRecord"'::regclass
    ) THEN
        ALTER TABLE "UsageRecord"
            ADD CONSTRAINT "UsageRecord_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
