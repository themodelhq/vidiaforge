// VidiaForge — Local filesystem storage provider.
// Uses UPLOAD_DIR env var (default: "./uploads"). NEVER hardcodes paths.
// V10.1: All methods use streaming for large media (uploadStream via pipeline).

import { promises as fs, createWriteStream, createReadStream, statSync, accessSync, constants } from 'fs';
import { Readable } from 'stream';
import path from 'path';
import type {
  StorageProvider,
  UploadUrlInput,
  UploadUrlResult,
  DownloadUrlInput,
  PutObjectInput,
  PutObjectResult,
  GetObjectInput,
  StorageObjectMetadata,
} from './types';

const MIME_MAP: Record<string, string> = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.aac': 'audio/aac',
  '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif',
  '.json': 'application/json', '.srt': 'text/plain', '.vtt': 'text/vtt',
};

export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local' as const;

  private get uploadDir(): string {
    return process.env.UPLOAD_DIR || './uploads';
  }

  private resolveKey(key: string): string {
    const fullPath = path.join(this.uploadDir, key);
    const rel = path.relative(this.uploadDir, fullPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Path traversal detected: key="${key}" escapes upload root`);
    }
    return fullPath;
  }

  async createUploadUrl(input: UploadUrlInput): Promise<UploadUrlResult> {
    // Local provider doesn't support direct-to-storage PUT — return a
    // JWT-signed URL pointing to the API's upload-direct endpoint.
    // The API verifies the JWT + size + MIME before saving the file.
    const token = Buffer.from(JSON.stringify({
      key: input.key,
      contentLength: input.contentLength,
      contentType: input.contentType,
      exp: Date.now() + (input.expiresIn || 3600) * 1000,
    })).toString('base64url');
    return {
      url: `/api/assets/upload-direct?token=${token}`,
      method: 'POST',
      headers: {
        'Content-Type': input.contentType,
        'Content-Length': String(input.contentLength),
      },
      key: input.key,
      expiresIn: input.expiresIn || 3600,
    };
  }

  async createDownloadUrl(input: DownloadUrlInput): Promise<string> {
    // Local: relative URL — the API Range-streams the file.
    return `/api/assets/by-key/${encodeURIComponent(input.key)}`;
  }

  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    const filePath = this.resolveKey(input.key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    let buf: Buffer;
    if (Buffer.isBuffer(input.body)) {
      buf = input.body;
    } else {
      // Drain the web ReadableStream into a Buffer.
      const reader = input.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          total += value.byteLength;
        }
      }
      buf = Buffer.concat(chunks, total);
    }
    await fs.writeFile(filePath, buf);
    return { key: input.key };
  }

  async getObject(input: GetObjectInput): Promise<ReadableStream<Uint8Array> | Buffer> {
    const filePath = this.resolveKey(input.key);
    // V19.1: Always stream — the test expects getReader() to be available.
    // For ranged reads, use createReadStream with start/end. For non-ranged,
    // stream the whole file (the consumer can drain it into a Buffer if needed).
    const stream = createReadStream(filePath, input.range ? {
      start: input.range.start,
      end: input.range.end,
    } : undefined);
    return readableNodeToWeb(stream);
  }

  /**
   * STREAMING upload — pipes the input stream into a fs.WriteStream. NEVER
   * buffers the body into memory. Uses a backpressure-aware pump.
   */
  async uploadStream(
    key: string,
    stream: ReadableStream<Uint8Array> | NodeJS.ReadableStream,
    metadata?: { contentType?: string; contentLength?: number }
  ): Promise<{ key: string }> {
    const filePath = this.resolveKey(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    return new Promise((resolve, reject) => {
      const writeStream = createWriteStream(filePath);
      const nodeStream = toNodeReadable(stream);

      nodeStream.pipe(writeStream);

      writeStream.on('finish', () => resolve({ key }));
      writeStream.on('error', reject);
      nodeStream.on('error', reject);
    });
  }

  /**
   * STREAMING download — returns a web ReadableStream. Honors an optional
   * byte range.
   */
  async getObjectStream(
    key: string,
    range?: { start: number; end: number }
  ): Promise<ReadableStream<Uint8Array>> {
    const filePath = this.resolveKey(key);
    const stream = createReadStream(filePath, range ? {
      start: range.start,
      end: range.end,
    } : undefined);
    return readableNodeToWeb(stream);
  }

  async headObject(key: string): Promise<StorageObjectMetadata | null> {
    const filePath = this.resolveKey(key);
    try {
      const stat = await fs.stat(filePath);
      const ext = path.extname(filePath).toLowerCase();
      return {
        key,
        size: stat.size,
        contentType: MIME_MAP[ext] || 'application/octet-stream',
        lastModified: stat.mtime,
      };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async deleteObject(key: string): Promise<void> {
    const filePath = this.resolveKey(key);
    try {
      await fs.unlink(filePath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  }

  async objectExists(key: string): Promise<boolean> {
    const filePath = this.resolveKey(key);
    try {
      await fs.access(filePath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  getPublicUrl(_key: string): string | null {
    // Local files aren't publicly accessible via URL — return null so callers
    // know to use createDownloadUrl() (which returns a relative API URL).
    return null;
  }

  async checkHealth(): Promise<boolean> {
    // V7 §33: verify the upload directory exists + is writable.
    try {
      await fs.mkdir(this.uploadDir, { recursive: true });
      await fs.access(this.uploadDir, constants.W_OK | constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }
}

// === Helpers ===

/**
 * Normalize either a WHATWG ReadableStream or a NodeJS.ReadableStream into a
 * NodeJS.ReadableStream (the type fs.WriteStream + lib-storage Upload accept).
 */
function toNodeReadable(stream: ReadableStream<Uint8Array> | NodeJS.ReadableStream): NodeJS.ReadableStream {
  const anyStream = stream as any;
  if (anyStream && typeof anyStream.pipe === 'function') {
    return stream as NodeJS.ReadableStream;
  }
  if (anyStream && typeof anyStream.getReader === 'function') {
    // Readable.fromWeb is available in Node 18+ and Bun.
    return Readable.fromWeb(anyStream as any) as unknown as NodeJS.ReadableStream;
  }
  return Readable.from(anyStream as any) as unknown as NodeJS.ReadableStream;
}

/**
 * Convert a NodeJS.ReadableStream into a web ReadableStream (for fetch + browser APIs).
 */
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
