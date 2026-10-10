// /api/assets/finalize — POST { uploadIntentId }
//
// V4-S1 — this endpoint was REWRITTEN to close the P0 security hole in the
// previous version, which accepted an ARBITRARY storage key from the client.
// That meant any authenticated user could finalize any S3 object by sending
// its key — no ownership check, no size verification, no idempotency.
//
// The new flow:
//   1. Authenticate user.
//   2. Accept ONLY `{ uploadIntentId }` from the client — never an arbitrary key.
//   3. Load the UploadIntent by ID. If missing → 404.
//   4. Verify ownership: `intent.userId === session.user.id` → 403 otherwise.
//   5. Verify intent isn't expired: `intent.expiresAt > now` → 410 (gone).
//   6. IDEMPOTENCY: if `intent.status === 'finalized'`, return the existing
//      MediaAsset (looked up by storagePath) — never create a duplicate.
//   7. Verify intent.status is in { 'created', 'uploaded' } — 'failed' /
//      'expired' are terminal.
//   8. Call `storage.headObject(intent.storageKey)`:
//        - Returns null → 400 STORAGE_OBJECT_NOT_FOUND (the direct-to-S3 PUT
//          didn't actually write the object).
//        - Returns metadata → compare `actualSize === Number(intent.expectedSize)`
//          (EXACT match, no tolerance). Mismatch → set intent.status='failed',
//          return 400 UPLOAD_SIZE_MISMATCH with { expected, actual }.
//   9. In a transaction: create MediaAsset + update intent.status='finalized'
//      + intent.finalizedAt=now.
//  10. Enqueue media-ingestion (if REDIS_URL available; HONEST warning if not).
//  11. Return { asset }.
//
// The transaction in step 9 is what makes the endpoint idempotent: if the
// client retries POST /finalize, step 6 short-circuits before step 9 runs
// again. Without the transaction, a duplicate finalize between steps 9a
// (create asset) and 9b (mark intent finalized) would create two MediaAssets
// for one intent.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { getStorage } from '@/lib/storage';
import { enqueue } from '@/lib/queue';
import { QUEUE_NAMES } from '@/lib/queue-names';
import { checkUploadRate, rateLimitHeaders } from '@/lib/rate-limit';
import { ERROR_CODES } from '@/lib/errors/codes';

// Mirror the upload route's MIME whitelist. Keep them in sync — the
// finalize endpoint MUST reject any MIME that the upload endpoint wouldn't
// have created an intent for, in case the intent was tampered with.
const ALLOWED_MIME: Record<string, { kind: 'video' | 'audio' | 'image'; ext: string }> = {
  'video/mp4': { kind: 'video', ext: 'mp4' },
  'video/quicktime': { kind: 'video', ext: 'mov' },
  'video/webm': { kind: 'video', ext: 'webm' },
  'audio/mpeg': { kind: 'audio', ext: 'mp3' },
  'audio/wav': { kind: 'audio', ext: 'wav' },
  'audio/aac': { kind: 'audio', ext: 'aac' },
  'audio/m4a': { kind: 'audio', ext: 'm4a' },
  'audio/ogg': { kind: 'audio', ext: 'ogg' },
  'image/jpeg': { kind: 'image', ext: 'jpg' },
  'image/png': { kind: 'image', ext: 'png' },
  'image/webp': { kind: 'image', ext: 'webp' },
  'image/gif': { kind: 'image', ext: 'gif' },
};

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required.' } },
      { status: 401 }
    );
  }

  // Rate limit (same bucket as upload — finalize is the second half of an
  // upload, so it shouldn't double the user's quota).
  const rl = checkUploadRate(user.id);
  if (!rl.allowed) {
    const res = NextResponse.json(
      { error: { code: ERROR_CODES.RATE_LIMITED, message: 'Too many upload requests. Please slow down.' } },
      { status: 429 }
    );
    for (const [k, v] of Object.entries(rateLimitHeaders(rl))) {
      res.headers.set(k, v);
    }
    return res;
  }

  // ── Parse body ────────────────────────────────────────────────────────
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body.' } },
      { status: 400 }
    );
  }

  const uploadIntentId = typeof body?.uploadIntentId === 'string' ? body.uploadIntentId : null;
  if (!uploadIntentId) {
    return NextResponse.json(
      {
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'uploadIntentId is required.',
        },
      },
      { status: 400 }
    );
  }

  // ── Load intent ────────────────────────────────────────────────────────
  const intent = await db.uploadIntent.findUnique({ where: { id: uploadIntentId } });
  if (!intent) {
    return NextResponse.json(
      { error: { code: ERROR_CODES.MEDIA_NOT_FOUND, message: 'Upload intent not found.' } },
      { status: 404 }
    );
  }

  // ── Ownership ──────────────────────────────────────────────────────────
  if (intent.userId !== user.id) {
    return NextResponse.json(
      { error: { code: ERROR_CODES.PROJECT_ACCESS_DENIED, message: 'You do not own this upload intent.' } },
      { status: 403 }
    );
  }

  // ── Expiry ─────────────────────────────────────────────────────────────
  const now = new Date();
  if (intent.expiresAt <= now) {
    // Mark expired so a sweep job can clean up the storage object.
    if (intent.status === 'created' || intent.status === 'uploaded') {
      await db.uploadIntent
        .update({ where: { id: intent.id }, data: { status: 'expired' } })
        .catch(() => {});
    }
    return NextResponse.json(
      {
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Upload intent has expired. Please restart the upload.',
        },
      },
      { status: 410 }
    );
  }

  // ── Idempotency: already finalized → return existing asset ────────────
  if (intent.status === 'finalized') {
    // Look up the MediaAsset by storagePath + userId. The storagePath is
    // unique per intent (intent.storageKey is unique), so this returns at
    // most one row.
    const existing = await db.mediaAsset.findFirst({
      where: { storagePath: intent.storageKey, userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return NextResponse.json(
        {
          asset: assetDTO(existing),
          idempotent: true,
          uploadIntentId: intent.id,
        },
        { status: 200 }
      );
    }
    // Intent is marked finalized but no MediaAsset found — orphaned. Fall
    // through to the regular finalize flow to repair the state.
    console.warn(
      `[finalize] UploadIntent ${intent.id} is marked finalized but no MediaAsset exists for storageKey="${intent.storageKey}". Re-finalizing.`
    );
  }

  // ── Status check: 'failed' / 'expired' are terminal ───────────────────
  if (intent.status === 'failed' || intent.status === 'expired') {
    return NextResponse.json(
      {
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `Upload intent is in terminal status "${intent.status}". Please restart the upload.`,
        },
      },
      { status: 400 }
    );
  }

  if (intent.status !== 'created' && intent.status !== 'uploaded') {
    return NextResponse.json(
      {
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `Upload intent is in unexpected status "${intent.status}".`,
        },
      },
      { status: 400 }
    );
  }

  // ── Verify the MIME is still allowed (defense in depth) ───────────────
  const meta = ALLOWED_MIME[intent.expectedMime];
  if (!meta) {
    return NextResponse.json(
      {
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `Intent has unsupported MIME type: ${intent.expectedMime}`,
        },
      },
      { status: 415 }
    );
  }

  // ── headObject(): verify the object exists + get real metadata ────────
  const storage = getStorage();
  let headMeta;
  try {
    headMeta = await storage.headObject(intent.storageKey);
  } catch (err) {
    // HONEST: storage transport error (auth, network, etc.) — don't mark the
    // intent as failed because retrying might succeed once the storage issue
    // is resolved.
    return NextResponse.json(
      {
        error: {
          code: ERROR_CODES.STORAGE_ERROR,
          message: 'Failed to verify uploaded object in storage.',
          details: err instanceof Error ? err.message : 'unknown',
        },
      },
      { status: 502 }
    );
  }

  if (!headMeta) {
    return NextResponse.json(
      {
        error: {
          code: ERROR_CODES.STORAGE_OBJECT_NOT_FOUND,
          message: 'Object not found in storage. Did the direct upload succeed?',
          details: { storageKey: intent.storageKey },
        },
      },
      { status: 400 }
    );
  }

  // ── Size check: EXACT match, no tolerance ─────────────────────────────
  const expectedSize = Number(intent.expectedSize);
  const actualSize = headMeta.size;
  if (actualSize !== expectedSize) {
    // Mark the intent as failed so the client can't keep retrying the same
    // intent with a wrong-size object. They must restart the upload.
    await db.uploadIntent
      .update({ where: { id: intent.id }, data: { status: 'failed' } })
      .catch(() => {});
    return NextResponse.json(
      {
        error: {
          code: ERROR_CODES.UPLOAD_SIZE_MISMATCH,
          message: 'Size mismatch: actual object size does not match expected size.',
          details: { expected: expectedSize, actual: actualSize, storageKey: intent.storageKey },
        },
      },
      { status: 400 }
    );
  }

  // ── Create MediaAsset + finalize intent in a transaction ──────────────
  // The transaction guarantees:
  //   - If MediaAsset.create fails (DB error, unique violation), the intent
  //     stays in 'created'/'uploaded' and the client can retry safely.
  //   - If intent.update fails, the asset is rolled back so we don't end up
  //     with an asset whose intent isn't marked finalized (which would
  //     confuse the idempotency check).
  let asset: any;
  try {
    const result = await db.$transaction(async (tx) => {
      const created = await tx.mediaAsset.create({
        data: {
          userId: user.id,
          projectId: intent.projectId,
          filename: intent.filename,
          internalName: intent.storageKey.split('/').pop() || intent.filename,
          mimeType: intent.expectedMime,
          size: actualSize,
          storagePath: intent.storageKey,
          kind: meta.kind,
          // Lifecycle: 'uploading' → 'processing' (worker picks up) → 'ready'.
          status: 'uploading',
        },
      });
      await tx.uploadIntent.update({
        where: { id: intent.id },
        data: {
          status: 'finalized',
          finalizedAt: new Date(),
        },
      });
      return created;
    });
    asset = result;
  } catch (err) {
    // If the failure is a unique-constraint violation on storagePath, an
    // asset already exists for this key — race condition with a duplicate
    // finalize call. Look it up + return it idempotently.
    const msg = err instanceof Error ? err.message : String(err);
    if (/unique|already exists|P2002/i.test(msg)) {
      const existing = await db.mediaAsset.findFirst({
        where: { storagePath: intent.storageKey, userId: user.id },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        // Mark intent finalized so subsequent retries short-circuit at step 6.
        await db.uploadIntent
          .update({ where: { id: intent.id }, data: { status: 'finalized', finalizedAt: new Date() } })
          .catch(() => {});
        return NextResponse.json(
          {
            asset: assetDTO(existing),
            idempotent: true,
            uploadIntentId: intent.id,
          },
          { status: 200 }
        );
      }
    }
    return NextResponse.json(
      {
        error: {
          code: ERROR_CODES.STORAGE_ERROR,
          message: 'Failed to create media asset.',
          details: msg,
        },
      },
      { status: 500 }
    );
  }

  // ── Enqueue media-ingestion (HONEST about missing Redis) ──────────────
  const enq = await enqueue(QUEUE_NAMES.MEDIA_INGEST, { assetId: asset.id });
  if (!enq.ok) {
    console.warn(
      `[finalize] REDIS_URL not configured — MediaAsset ${asset.id} stuck at status='uploading'. ` +
        `Media ingestion will NOT run until a worker is configured. Detail: ${enq.error}`
    );
  }

  return NextResponse.json(
    {
      asset: assetDTO(asset),
      uploadIntentId: intent.id,
      queue: enq.ok
        ? { enqueued: true, jobId: enq.jobId }
        : { enqueued: false, warning: `Media metadata extraction will not run until a worker is configured. (${enq.error})` },
    },
    { status: 201 }
  );
}

// === DTO ===================================================================

function assetDTO(a: any) {
  return {
    id: a.id,
    filename: a.filename,
    mimeType: a.mimeType,
    size: a.size,
    kind: a.kind,
    duration: a.duration,
    width: a.width,
    height: a.height,
    fps: a.fps,
    thumbnailUrl: a.thumbnailUrl,
    waveformUrl: a.waveformUrl,
    createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : a.createdAt,
    storagePath: a.storagePath,
    status: a.status,
    errorMessage: a.errorMessage,
  };
}
