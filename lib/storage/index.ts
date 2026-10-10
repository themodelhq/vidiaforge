// VidiaForge — Storage factory.
// Reads STORAGE_PROVIDER env var ("local" default, "s3"/"r2" for S3-compatible).
// Returns a memoized singleton.

import type { StorageProvider } from './types';
import { LocalStorageProvider } from './local-provider';

let provider: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (provider) return provider;
  const name = (process.env.STORAGE_PROVIDER || 'local').toLowerCase();
  if (name === 'local') {
    provider = new LocalStorageProvider();
    return provider;
  }
  if (name === 's3' || name === 'r2') {
    // Lazy wrapper so missing @aws-sdk packages don't crash the app at boot.
    // The factory itself does NOT throw — callers must catch on first use.
    return new LazyS3Provider();
  }
  throw new Error(`Unknown STORAGE_PROVIDER "${name}". Use "local", "s3", or "r2".`);
}

/**
 * Lazy wrapper that defers S3 SDK construction until first method call.
 * This means `getStorage()` always returns without throwing, and the
 * clear error message surfaces only when a caller actually uses the provider.
 */
class LazyS3Provider implements StorageProvider {
  readonly name = 's3' as const;
  private inner: StorageProvider | null = null;

  private async get(): Promise<StorageProvider> {
    if (this.inner) return this.inner;
    const { S3StorageProvider } = await import('./s3-provider');
    this.inner = new S3StorageProvider();
    return this.inner;
  }

  async createUploadUrl(input: Parameters<StorageProvider['createUploadUrl']>[0]) {
    return (await this.get()).createUploadUrl(input);
  }
  async createDownloadUrl(input: Parameters<StorageProvider['createDownloadUrl']>[0]) {
    return (await this.get()).createDownloadUrl(input);
  }
  async putObject(input: Parameters<StorageProvider['putObject']>[0]) {
    return (await this.get()).putObject(input);
  }
  async getObject(input: Parameters<StorageProvider['getObject']>[0]) {
    return (await this.get()).getObject(input);
  }
  async uploadStream(
    key: string,
    stream: ReadableStream<Uint8Array> | NodeJS.ReadableStream,
    metadata?: { contentType?: string; contentLength?: number }
  ): Promise<{ key: string }> {
    return (await this.get()).uploadStream(key, stream, metadata);
  }
  async getObjectStream(key: string, range?: { start: number; end: number }): Promise<ReadableStream<Uint8Array>> {
    return (await this.get()).getObjectStream(key, range);
  }
  async headObject(key: string) {
    return (await this.get()).headObject(key);
  }
  async deleteObject(key: string) {
    return (await this.get()).deleteObject(key);
  }
  async objectExists(key: string) {
    return (await this.get()).objectExists(key);
  }
  getPublicUrl(key: string) {
    // Synchronous — can't lazy-await. Return null if not yet initialized; caller can re-call.
    if (this.inner) return this.inner.getPublicUrl(key);
    const base = process.env.STORAGE_PUBLIC_BASE_URL;
    return base ? `${base.replace(/\/$/, '')}/${key.replace(/^\/+/, '')}` : null;
  }
  async checkHealth() {
    return (await this.get()).checkHealth();
  }
}

export type {
  StorageProvider,
  StorageObjectMetadata,
  UploadUrlInput,
  UploadUrlResult,
  DownloadUrlInput,
  PutObjectInput,
  GetObjectInput,
} from './types';
export { LocalStorageProvider } from './local-provider';
export { S3StorageProvider } from './s3-provider';
