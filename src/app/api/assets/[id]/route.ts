// /api/assets/[id] — GET (Range-stream from local FS OR redirect to presigned S3 URL),
// DELETE (record + storage object). Removes hardcoded /home/z/my-project path.
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { getStorage } from '@/lib/storage';
import { createReadStream, stat } from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import { promisify } from 'util';

const statP = promisify(stat);

interface Ctx {
  params: Promise<{ id: string }>;
}

async function loadOwnedAsset(id: string, userId: string) {
  const asset = await db.mediaAsset.findUnique({ where: { id } });
  if (!asset) return null;
  if (asset.userId !== userId) return 'forbidden' as const;
  return asset;
}

export async function GET(req: Request, { params }: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const asset = await loadOwnedAsset(id, user.id);
  if (!asset) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (asset === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const storage = getStorage();

  // === S3/R2 path: redirect to presigned download URL ===
  if (storage.name !== 'local') {
    try {
      const url = await storage.createDownloadUrl({ key: asset.storagePath, expiresIn: 3600 });
      return NextResponse.redirect(url, { status: 302 });
    } catch (err) {
      return NextResponse.json(
        { error: 'Failed to create download URL', detail: err instanceof Error ? err.message : 'unknown' },
        { status: 500 }
      );
    }
  }

  // === Local path: Range-stream from UPLOAD_DIR (env var, default ./uploads) ===
  const uploadDir = process.env.UPLOAD_DIR || './uploads';
  // storagePath may be "uploads/abc.mp4" — strip leading "uploads/" if present
  let relPath = asset.storagePath;
  if (relPath.startsWith('uploads/') || relPath.startsWith('uploads\\')) {
    relPath = relPath.slice('uploads/'.length);
  }
  const abs = path.isAbsolute(relPath) ? relPath : path.resolve(uploadDir, relPath);

  let size: number;
  try {
    const s = await statP(abs);
    size = s.size;
  } catch {
    return NextResponse.json({ error: 'File not found on disk' }, { status: 410 });
  }

  const rangeHeader = req.headers.get('range');

  if (!rangeHeader) {
    const stream = createReadStream(abs);
    const headers = new Headers({
      'Content-Type': asset.mimeType || 'application/octet-stream',
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=0',
    });
    return new Response(readableNodeToWeb(stream), { status: 200, headers });
  }

  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!m) {
    return NextResponse.json({ error: 'Invalid Range header' }, { status: 416 });
  }
  const startStr = m[1];
  const endStr = m[2];

  let start: number;
  let end: number;
  if (startStr === '' && endStr === '') {
    return NextResponse.json({ error: 'Invalid Range' }, { status: 416 });
  }
  if (startStr === '') {
    const suffix = parseInt(endStr, 10);
    if (!isFinite(suffix) || suffix <= 0) {
      return NextResponse.json({ error: 'Invalid Range' }, { status: 416 });
    }
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(startStr, 10);
    end = endStr === '' ? size - 1 : parseInt(endStr, 10);
    if (!isFinite(start) || start < 0 || start >= size) {
      return NextResponse.json({ error: 'Invalid Range' }, { status: 416 });
    }
    if (!isFinite(end) || end >= size) end = size - 1;
    if (end < start) {
      return NextResponse.json({ error: 'Invalid Range' }, { status: 416 });
    }
  }

  const chunkSize = end - start + 1;
  const stream = createReadStream(abs, { start, end });
  const webStream = readableNodeToWeb(stream);

  const headers = new Headers({
    'Content-Type': asset.mimeType || 'application/octet-stream',
    'Content-Length': String(chunkSize),
    'Content-Range': `bytes ${start}-${end}/${size}`,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=0',
  });

  return new Response(webStream, { status: 206, headers });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const asset = await loadOwnedAsset(id, user.id);
  if (!asset) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (asset === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Delete DB record first; then attempt storage removal (best-effort)
  await db.mediaAsset.delete({ where: { id } });

  try {
    const storage = getStorage();
    await storage.deleteObject(asset.storagePath);
  } catch {
    // Best-effort: ignore storage errors
  }

  // Also remove local file from UPLOAD_DIR if it exists (legacy path support)
  try {
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    let relPath = asset.storagePath;
    if (relPath.startsWith('uploads/') || relPath.startsWith('uploads\\')) {
      relPath = relPath.slice('uploads/'.length);
    }
    const abs = path.isAbsolute(relPath) ? relPath : path.resolve(uploadDir, relPath);
    await fsp.unlink(abs);
  } catch {
    // best-effort
  }

  return NextResponse.json({ ok: true });
}

// Convert a Node.js Readable stream into a WHATWG ReadableStream
function readableNodeToWeb(stream: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  const reader = stream as any;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      reader.on('data', (chunk: Buffer | Uint8Array) => {
        controller.enqueue(new Uint8Array(chunk as Uint8Array));
      });
      reader.on('end', () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
      reader.on('error', (err: unknown) => {
        controller.error(err);
      });
    },
    cancel(reason) {
      try {
        reader.destroy(reason);
      } catch {
        /* ignore */
      }
    },
  });
}
