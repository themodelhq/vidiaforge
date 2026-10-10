// VidiaForge — S3-compatible StorageProvider (AWS S3 / Cloudflare R2 / MinIO)
// Uses @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner via DYNAMIC import —
// those packages are optional deps so the app still boots if they aren't installed.
// If the import fails we throw a clear, actionable error.

import path from 'path';
import { Readable } from 'stream';
import type {
  StorageProvider,
  StorageObjectMetadata,
  UploadUrlInput,
  UploadUrlResult,
  DownloadUrlInput,
  PutObjectInput,
  PutObjectResult,
  GetObjectInput,
} from './types';

// We avoid static imports — the SDK is only required at runtime.
type S3ClientLike = {
  send: (cmd: unknown) => Promise<unknown>;
};

interface LoadedSdk {
  S3Client: new (config: unknown) => S3ClientLike;
  PutObjectCommand: new (input: unknown) => unknown;
  GetObjectCommand: new (input: unknown) => unknown;
  DeleteObjectCommand: new (input: unknown) => unknown;
  HeadObjectCommand: new (input: unknown) => unknown;
  getSignedUrl: (client: S3ClientLike, command: unknown, options: { expiresIn: number }) => Promise<string>;
}

let sdkPromise: Promise<LoadedSdk> | null = null;

async function loadSdk(): Promise<LoadedSdk> {
  if (!sdkPromise) {
    sdkPromise = (async () => {
      try {
        // Dynamic import — never bundled if packages aren't installed.
        const s3Mod: any = await import('@aws-sdk/client-s3');
        const presignMod: any = await import('@aws-sdk/s3-request-presigner');
        if (!s3Mod?.S3Client || !presignMod?.getSignedUrl) {
          throw new Error('Missing exports in @aws-sdk packages');
        }
        return {
          S3Client: s3Mod.S3Client,
          PutObjectCommand: s3Mod.PutObjectCommand,
          GetObjectCommand: s3Mod.GetObjectCommand,
          DeleteObjectCommand: s3Mod.DeleteObjectCommand,
          HeadObjectCommand: s3Mod.HeadObjectCommand,
          getSignedUrl: presignMod.getSignedUrl,
        } as LoadedSdk;
      } catch (err) {
        sdkPromise = null; // allow retry on next call
        throw new Error(
          'S3 provider requires @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner. ' +
            'Install them (`bun add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`) or set STORAGE_PROVIDER=local. ' +
            `Underlying error: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })();
  }
  return sdkPromise;
}

export class S3StorageProvider implements StorageProvider {
  readonly name: 's3' | 'r2';
  private sdk: LoadedSdk | null = null;
  private client: S3ClientLike | null = null;

  constructor() {
    const bucket = process.env.STORAGE_BUCKET;
    if (!bucket) {
      throw new Error('STORAGE_BUCKET env var is required for the S3 provider.');
    }
    // "r2" if endpoint hostname contains cloudflare/r2, else "s3"
    const endpoint = process.env.STORAGE_ENDPOINT || '';
    this.name = /r2|cloudflare/i.test(endpoint) ? 'r2' : 's3';
  }

  private async init(): Promise<{ sdk: LoadedSdk; client: S3ClientLike; bucket: string }> {
    if (this.sdk && this.client) {
      return { sdk: this.sdk, client: this.client, bucket: process.env.STORAGE_BUCKET! };
    }
    const sdk = await loadSdk();
    const endpoint = process.env.STORAGE_ENDPOINT || undefined;
    const region = process.env.STORAGE_REGION || 'auto';
    const accessKeyId = process.env.STORAGE_ACCESS_KEY;
    const secretAccessKey = process.env.STORAGE_SECRET_KEY;
    if (!accessKeyId || !secretAccessKey) {
      throw new Error(
        'STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY are required for the S3 provider.'
      );
    }
    const client = new sdk.S3Client({
      region,
      endpoint,
      // forcePathStyle helps with MinIO + some R2 configs
      forcePathStyle: endpoint ? /minio|localhost|127\.0\.0\.1/i.test(endpoint) : false,
      credentials: { accessKeyId, secretAccessKey },
    });
    this.sdk = sdk;
    this.client = client;
    return { sdk, client, bucket: process.env.STORAGE_BUCKET! };
  }

  async createUploadUrl(input: UploadUrlInput): Promise<UploadUrlResult> {
    const { sdk, client, bucket } = await this.init();
    const expiresIn = Math.min(input.expiresIn ?? 900, 3600);
    // V4-S1 CRITICAL FIX: sign ContentLength with the ACTUAL file size
    // (`input.contentLength`), NOT a hard-coded 500MB max. The previous
    // implementation signed every URL for 500MB regardless of the true
    // upload size, which (a) caused S3 to reject uploads whose body length
    // didn't match and (b) let attackers upload arbitrarily-large files
    // up to the signed 500MB ceiling.
    //
    // Callers MUST validate `contentLength <= MAX_UPLOAD_BYTES` BEFORE
    // invoking this method — the presigned URL enforces what was signed,
    // but doesn't cap the cap.
    if (!Number.isFinite(input.contentLength) || input.contentLength <= 0) {
      throw new Error(
        `createUploadUrl: contentLength must be a positive finite number (got ${input.contentLength})`
      );
    }
    const cmd = new sdk.PutObjectCommand({
      Bucket: bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
    });
    const url = await sdk.getSignedUrl(client, cmd, { expiresIn });
    return {
      url,
      method: 'PUT',
      headers: {
        'Content-Type': input.contentType,
        'Content-Length': String(input.contentLength),
      },
      key: input.key,
      expiresIn,
    };
  }

  /**
   * HEAD object — fetch S3 object metadata WITHOUT downloading the body.
   *
   * V4-S1: used by /api/assets/finalize to verify (a) the direct-to-S3 PUT
   * actually wrote an object and (b) its real ContentLength matches the
   * UploadIntent.expectedSize before creating a MediaAsset row. Returns
   * null on NoSuchKey / 404 so callers can branch cleanly without try/catch.
   */
  async headObject(key: string): Promise<StorageObjectMetadata | null> {
    const { sdk, client, bucket } = await this.init();
    try {
      const resp: any = await client.send(
        new sdk.HeadObjectCommand({ Bucket: bucket, Key: key })
      );
      if (!resp) return null;
      return {
        key,
        size: typeof resp.ContentLength === 'number' ? resp.ContentLength : Number(resp.ContentLength ?? 0),
        contentType: typeof resp.ContentType === 'string' ? resp.ContentType : undefined,
        etag: typeof resp.ETag === 'string' ? resp.ETag.replace(/^"|"$/g, '') : undefined,
        lastModified: resp.LastModified instanceof Date ? resp.LastModified : undefined,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // S3 returns NotFound (HTTP 404) when the object doesn't exist. The AWS
      // SDK v3 throws an error with name 'NotFound' / '$NotFound' or a
      // statusCode/S3-specific message. Match the common patterns and return
      // null; only propagate transport errors (auth, network, etc.).
      if (/NotFound|NoSuchKey|404/i.test(msg)) return null;
      throw err;
    }
  }

  async createDownloadUrl(input: DownloadUrlInput): Promise<string> {
    const { sdk, client, bucket } = await this.init();
    const expiresIn = Math.min(input.expiresIn ?? 3600, 7 * 24 * 3600);
    const cmd = new sdk.GetObjectCommand({ Bucket: bucket, Key: input.key });
    return sdk.getSignedUrl(client, cmd, { expiresIn });
  }

  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    const { sdk, client, bucket } = await this.init();
    let body: Uint8Array | Buffer;
    if (Buffer.isBuffer(input.body)) {
      body = input.body;
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
      body = Buffer.concat(chunks, total);
    }
    await client.send(
      new sdk.PutObjectCommand({
        Bucket: bucket,
        Key: input.key,
        Body: body,
        ContentType: input.contentType,
      })
    );
    return { key: input.key };
  }

  async getObject(input: GetObjectInput): Promise<ReadableStream<Uint8Array> | Buffer> {
    const { sdk, client, bucket } = await this.init();
    const range =
      input.range != null
        ? `bytes=${input.range.start}-${input.range.end}`
        : undefined;
    const cmd = new sdk.GetObjectCommand({
      Bucket: bucket,
      Key: input.key,
      Range: range,
    });
    const resp: any = await client.send(cmd);
    if (!resp || !resp.Body) {
      throw new Error(`S3 GetObject returned no body for key ${input.key}`);
    }
    // S3 SDK v3 returns a web ReadableStream under Node 18+ for Body.
    // Convert node-stream to web stream if needed.
    if (typeof resp.Body.getReader === 'function') {
      return resp.Body as ReadableStream<Uint8Array>;
    }
    if (typeof resp.Body.pipe === 'function') {
      return readableNodeToWeb(resp.Body as NodeJS.ReadableStream);
    }
    // Fallback to Buffer (already buffered).
    return Buffer.isBuffer(resp.Body) ? resp.Body : Buffer.from(resp.Body);
  }

  /**
   * STREAMING upload — uses @aws-sdk/lib-storage's `Upload` class for S3
   * multipart upload. NEVER buffers the body into memory: the SDK reads the
   * stream in 5+ MB chunks and uploads each as a separate part. This is the
   * CRITICAL fix for large files (>100MB renders) that previously caused OOM
   * with `putObject` (which drained to Buffer).
   *
   * `@aws-sdk/lib-storage` is loaded via DYNAMIC import inside try/catch so
   * the package is optional at install time — callers get a clear, actionable
   * error message if it isn't installed.
   */
  async uploadStream(
    key: string,
    stream: ReadableStream<Uint8Array> | NodeJS.ReadableStream,
    metadata?: { contentType?: string; contentLength?: number }
  ): Promise<{ key: string }> {
    const { client, bucket } = await this.init();

    let UploadCtor: any = null;
    try {
      const libStorageMod: any = await import('@aws-sdk/lib-storage');
      UploadCtor = libStorageMod?.Upload ?? libStorageMod?.default?.Upload;
      if (typeof UploadCtor !== 'function') {
        throw new Error('Upload export not found on @aws-sdk/lib-storage');
      }
    } catch (err) {
      throw new Error(
        'S3 streaming upload requires @aws-sdk/lib-storage. ' +
          'Install it (`bun add @aws-sdk/lib-storage`) or use STORAGE_PROVIDER=local. ' +
          `Underlying error: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // The Upload class accepts a Node Readable as Body. Normalize web streams.
    const body = toNodeReadable(stream);

    const uploadParams: any = {
      client,
      params: {
        Bucket: bucket,
        Key: key,
        Body: body,
      },
    };
    if (metadata?.contentType) {
      uploadParams.params.ContentType = metadata.contentType;
    }
    if (typeof metadata?.contentLength === 'number' && metadata.contentLength > 0) {
      uploadParams.params.ContentLength = metadata.contentLength;
    }

    const uploader = new UploadCtor(uploadParams);
    await uploader.done();
    return { key };
  }

  /**
   * STREAMING download — issues GetObject with optional Range and returns the
   * SDK's response Body as a web ReadableStream. NEVER buffers the entire
   * object into memory.
   */
  async getObjectStream(
    key: string,
    range?: { start: number; end: number }
  ): Promise<ReadableStream<Uint8Array>> {
    const { sdk, client, bucket } = await this.init();
    const rangeHeader =
      range != null ? `bytes=${range.start}-${range.end}` : undefined;
    const cmd = new sdk.GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: rangeHeader,
    });
    const resp: any = await client.send(cmd);
    if (!resp || !resp.Body) {
      throw new Error(`S3 GetObject returned no body for key ${key}`);
    }
    if (typeof resp.Body.getReader === 'function') {
      return resp.Body as ReadableStream<Uint8Array>;
    }
    if (typeof resp.Body.pipe === 'function') {
      return readableNodeToWeb(resp.Body as NodeJS.ReadableStream);
    }
    // Already buffered (rare for AWS SDK v3) — wrap into a one-shot stream.
    const buf = Buffer.isBuffer(resp.Body) ? resp.Body : Buffer.from(resp.Body);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(buf));
        controller.close();
      },
    });
  }

  async deleteObject(key: string): Promise<void> {
    const { sdk, client, bucket } = await this.init();
    try {
      await client.send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch (err) {
      // Best-effort: log but don't throw on missing.
      if (!String(err).includes('NoSuchKey')) {
        throw err;
      }
    }
  }

  async objectExists(key: string): Promise<boolean> {
    const { sdk, client, bucket } = await this.init();
    try {
      await client.send(new sdk.HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/NotFound|404|NoSuchKey/i.test(msg)) return false;
      throw err;
    }
  }

  getPublicUrl(key: string): string | null {
    const base = process.env.STORAGE_PUBLIC_BASE_URL;
    if (!base) return null;
    return `${base.replace(/\/$/, '')}/${path.posix.normalize(key).replace(/^\/+/, '')}`;
  }

  async checkHealth(): Promise<boolean> {
    // V7 §33: HeadBucket equivalent — verify credentials work.
    // V17.1: Fix bug — was referencing this.bucket + this.getClient() which
    // don't exist on the class. Use the existing init() method which returns
    // the cached client + bucket name from process.env.
    try {
      const { sdk, client, bucket } = await this.init();
      const { HeadBucketCommand } = await import('@aws-sdk/client-s3');
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      return true;
    } catch {
      return false;
    }
  }
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

/**
 * Normalize either a WHATWG ReadableStream or a NodeJS.ReadableStream into a
 * NodeJS.ReadableStream that @aws-sdk/lib-storage Upload accepts as Body.
 */
function toNodeReadable(stream: ReadableStream<Uint8Array> | NodeJS.ReadableStream): NodeJS.ReadableStream {
  const anyStream = stream as any;
  if (anyStream && typeof anyStream.pipe === 'function') {
    return stream as NodeJS.ReadableStream;
  }
  if (anyStream && typeof anyStream.getReader === 'function') {
    // Readable.fromWeb is available in Node 18+ and Bun. Cast through any
    // because Node's ReadableStream type defs differ slightly from the
    // DOM ReadableStream — at runtime the APIs are identical.
    return Readable.fromWeb(anyStream as any) as unknown as NodeJS.ReadableStream;
  }
  return Readable.from(anyStream as any) as unknown as NodeJS.ReadableStream;
}
