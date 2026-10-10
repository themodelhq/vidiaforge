// /api/assets/upload — POST multipart/form-data
//
// V17.1 §39: This endpoint was missing (audit gap) — the frontend
// (media-panel.tsx:44, recording-dialog.tsx) was calling it but it 404'd.
//
// Flow:
//   1. Authenticate user.
//   2. Accept multipart/form-data with `file` (Blob) + `projectId` (string).
//   3. Validate MIME against the whitelist.
//   4. Validate size against MAX_UPLOAD_BYTES.
//   5. Generate a unique storageKey: uploads/<userId>/<assetId>/<filename>
//   6. Store via storage.uploadStream() (streaming — no buffering for large files).
//   7. Create MediaAsset record.
//   8. Enqueue media-ingestion for metadata extraction.
//   9. Return { asset }.
//
// V17.1 §59: This is the simple single-shot upload path. Production with very
// large files should prefer the presigned-URL flow (/api/assets/upload-intent +
// /api/assets/finalize) which is already implemented and supports direct-to-S3
// uploads. This endpoint is for developer convenience + small files.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { getStorage } from '@/lib/storage';
import { enqueue } from '@/lib/queue';
import { QUEUE_NAMES } from '@/lib/queue-names';
import { checkUploadRate, rateLimitHeaders } from '@/lib/rate-limit';
import { ERROR_CODES } from '@/lib/errors/codes';
import { randomUUID } from 'crypto';

const MAX_UPLOAD_BYTES = parseInt(
  process.env.MAX_UPLOAD_BYTES || String(500 * 1024 * 1024),
  10
);

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

export const runtime = 'nodejs'; // Required for streaming uploads.

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required.' } },
      { status: 401 }
    );
  }

  // Rate limit
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

  // Parse multipart form
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid multipart form data.' } },
      { status: 400 }
    );
  }

  const file = formData.get('file');
  const projectId = formData.get('projectId');

  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'Missing "file" field in form data.' } },
      { status: 400 }
    );
  }
  if (typeof projectId !== 'string' || !projectId) {
    return NextResponse.json(
      { error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'Missing "projectId" field in form data.' } },
      { status: 400 }
    );
  }

  // Validate project ownership
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project || project.userId !== user.id) {
    // V10.1 §8: Do not leak resource existence — return 404
    return NextResponse.json(
      { error: { code: ERROR_CODES.MEDIA_NOT_FOUND, message: 'Project not found.' } },
      { status: 404 }
    );
  }

  // Validate MIME
  const mimeType = file.type || 'application/octet-stream';
  const meta = ALLOWED_MIME[mimeType];
  if (!meta) {
    return NextResponse.json(
      {
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `Unsupported MIME type: ${mimeType}. Allowed: ${Object.keys(ALLOWED_MIME).join(', ')}`,
        },
      },
      { status: 415 }
    );
  }

  // Validate size
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: {
          code: ERROR_CODES.UPLOAD_SIZE_MISMATCH,
          message: `File too large: ${file.size} bytes (max ${MAX_UPLOAD_BYTES})`,
        },
      },
      { status: 413 }
    );
  }

  // Generate storage key + stream upload
  const assetId = randomUUID();
  const safeFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_') || `upload-${assetId}.${meta.ext}`;
  const storageKey = `uploads/${user.id}/${assetId}/${safeFilename}`;

  const storage = getStorage();
  try {
    // V10.1: Stream the Blob to storage — no buffering for large files.
    // The Blob.stream() returns a ReadableStream that uploadStream() consumes.
    const stream = file.stream();
    await storage.uploadStream(storageKey, stream, {
      contentType: mimeType,
      contentLength: file.size,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: ERROR_CODES.STORAGE_ERROR,
          message: 'Failed to upload file to storage.',
          details: err instanceof Error ? err.message : 'unknown',
        },
      },
      { status: 502 }
    );
  }

  // Create MediaAsset record
  let asset: any;
  try {
    asset = await db.mediaAsset.create({
      data: {
        id: assetId,
        userId: user.id,
        projectId,
        filename: file.name,
        internalName: storageKey.split('/').pop() || file.name,
        mimeType,
        size: file.size,
        storagePath: storageKey,
        kind: meta.kind,
        status: 'uploading',
      },
    });
  } catch (err) {
    // Best-effort cleanup of the uploaded storage object on DB failure.
    await storage.deleteObject(storageKey).catch(() => {});
    return NextResponse.json(
      {
        error: {
          code: ERROR_CODES.STORAGE_ERROR,
          message: 'Failed to create media asset record.',
          details: err instanceof Error ? err.message : 'unknown',
        },
      },
      { status: 500 }
    );
  }

  // Enqueue media-ingestion (HONEST about missing Redis)
  const enq = await enqueue(QUEUE_NAMES.MEDIA_INGEST, { assetId: asset.id });
  if (!enq.ok) {
    console.warn(
      `[upload] REDIS_URL not configured — MediaAsset ${asset.id} stuck at status='uploading'. ` +
      `Media ingestion will NOT run until a worker is configured. Detail: ${enq.error}`
    );
  }

  return NextResponse.json(
    {
      asset: assetDTO(asset),
      queue: enq.ok
        ? { enqueued: true, jobId: enq.jobId }
        : { enqueued: false, warning: `Media metadata extraction will not run until a worker is configured. (${enq.error})` },
    },
    { status: 201 }
  );
}

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
    status: a.status || 'ready',
    errorMessage: a.errorMessage,
  };
}
