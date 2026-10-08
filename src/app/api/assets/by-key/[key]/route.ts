// /api/assets/by-key/[key] — Range-stream an asset directly by storage key.
// Used by LocalStorageProvider.createDownloadUrl() to serve objects that aren't MediaAssets.
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getStorage } from '@/lib/storage';
import { createReadStream, stat } from 'fs';
import path from 'path';
import { promisify } from 'util';

const statP = promisify(stat);

interface Ctx {
  params: Promise<{ key: string }>;
}

export async function GET(req: Request, { params }: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { key: encodedKey } = await params;
  const key = decodeURIComponent(encodedKey);

  const storage = getStorage();

  // S3 path: redirect to presigned URL
  if (storage.name !== 'local') {
    try {
      const url = await storage.createDownloadUrl({ key, expiresIn: 3600 });
      return NextResponse.redirect(url, { status: 302 });
    } catch (err) {
      return NextResponse.json(
        { error: 'Failed to create download URL', detail: err instanceof Error ? err.message : 'unknown' },
        { status: 500 }
      );
    }
  }

  // Local path: Range-stream from UPLOAD_DIR
  const uploadDir = process.env.UPLOAD_DIR || './uploads';
  let relPath = key;
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
  const mimeType = guessMimeFromKey(key);

  if (!rangeHeader) {
    const stream = createReadStream(abs);
    const headers = new Headers({
      'Content-Type': mimeType,
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
    'Content-Type': mimeType,
    'Content-Length': String(chunkSize),
    'Content-Range': `bytes ${start}-${end}/${size}`,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=0',
  });

  return new Response(webStream, { status: 206, headers });
}

function guessMimeFromKey(key: string): string {
  const ext = path.extname(key).toLowerCase();
  const map: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.aac': 'audio/aac',
    '.m4a': 'audio/m4a',
    '.ogg': 'audio/ogg',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.json': 'application/json',
  };
  return map[ext] || 'application/octet-stream';
}

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
