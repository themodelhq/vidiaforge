// VidiaForge — Unit tests for LocalStorageProvider
//
// Tests src/lib/storage/local-provider.ts.
//
// Test isolation: uses Node's os.tmpdir() + mkdtemp() for a fresh temp
// dir per test. Sets UPLOAD_DIR env var to the temp dir so the provider
// writes there.
//
// Run: bun run test:unit

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { LocalStorageProvider } from '../../src/lib/storage/local-provider';
import { promises as fs, createReadStream, statSync, existsSync } from 'fs';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { Readable } from 'stream';

describe('LocalStorageProvider', () => {
  let tempDir: string;
  let provider: LocalStorageProvider;
  let previousJwtSecret: string | undefined;
  let previousUploadDir: string | undefined;

  beforeEach(async () => {
    // Create a fresh temp dir per test
    tempDir = await mkdtemp(path.join(tmpdir(), 'vf-storage-test-'));
    provider = new LocalStorageProvider();

    // Save previous env vars
    previousJwtSecret = process.env.JWT_SECRET;
    previousUploadDir = process.env.UPLOAD_DIR;

    // Set env vars for the test
    process.env.UPLOAD_DIR = tempDir;
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long-xxx';
  });

  afterEach(async () => {
    // Restore env vars
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;
    if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousUploadDir;

    // Clean up the temp dir
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  describe('putObject', () => {
    test('writes a Buffer to the upload dir', async () => {
      const key = 'uploads/test-put.txt';
      const body = Buffer.from('hello world');

      await provider.putObject({ key, body, contentType: 'text/plain' });

      // Verify the file exists at the expected path
      const expectedPath = path.join(tempDir, key);
      expect(existsSync(expectedPath)).toBe(true);

      // Verify the contents
      const contents = await readFile(expectedPath, 'utf-8');
      expect(contents).toBe('hello world');
    });

    test('writes a ReadableStream to the upload dir', async () => {
      const key = 'uploads/test-stream.txt';
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('streamed content'));
          controller.close();
        },
      });

      await provider.putObject({ key, body, contentType: 'text/plain' });

      const expectedPath = path.join(tempDir, key);
      expect(existsSync(expectedPath)).toBe(true);

      const contents = await readFile(expectedPath, 'utf-8');
      expect(contents).toBe('streamed content');
    });

    test('creates nested directories automatically', async () => {
      const key = 'uploads/nested/deeply/in/dirs/file.txt';
      const body = Buffer.from('nested');

      await provider.putObject({ key, body, contentType: 'text/plain' });

      const expectedPath = path.join(tempDir, key);
      expect(existsSync(expectedPath)).toBe(true);
    });

    test('returns the key in the result', async () => {
      const key = 'uploads/return-key-test.txt';
      const result = await provider.putObject({
        key,
        body: Buffer.from('test'),
        contentType: 'text/plain',
      });
      expect(result.key).toBe(key);
    });

    test('rejects paths that escape the upload root (path traversal)', async () => {
      const maliciousKey = '../../../etc/passwd';
      const body = Buffer.from('evil');

      await expect(
        provider.putObject({ key: maliciousKey, body, contentType: 'text/plain' })
      ).rejects.toThrow(/escapes upload root/);
    });
  });

  describe('objectExists', () => {
    test('returns true after putObject', async () => {
      const key = 'uploads/exists-after-put.txt';
      await provider.putObject({
        key,
        body: Buffer.from('content'),
        contentType: 'text/plain',
      });

      const exists = await provider.objectExists(key);
      expect(exists).toBe(true);
    });

    test('returns false for a key that was never written', async () => {
      const exists = await provider.objectExists('uploads/never-written.txt');
      expect(exists).toBe(false);
    });

    test('returns false after deleteObject', async () => {
      const key = 'uploads/exists-after-delete.txt';
      await provider.putObject({
        key,
        body: Buffer.from('content'),
        contentType: 'text/plain',
      });
      await provider.deleteObject(key);

      const exists = await provider.objectExists(key);
      expect(exists).toBe(false);
    });
  });

  describe('getObject', () => {
    test('returns the same bytes that were put', async () => {
      const key = 'uploads/get-bytes.txt';
      const original = Buffer.from('the bytes I put in');
      await provider.putObject({
        key,
        body: original,
        contentType: 'text/plain',
      });

      const result = await provider.getObject({ key });
      // Result is a web ReadableStream — drain it to a Buffer
      const reader = (result as ReadableStream<Uint8Array>).getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      const drained = Buffer.concat(chunks);

      expect(drained.equals(original)).toBe(true);
    });

    test('returns a stream that can be read with async iteration', async () => {
      const key = 'uploads/get-iter.txt';
      const original = Buffer.from('async iteration content');
      await provider.putObject({
        key,
        body: original,
        contentType: 'text/plain',
      });

      const result = await provider.getObject({ key });
      const reader = (result as ReadableStream<Uint8Array>).getReader();
      const chunks: Buffer[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(Buffer.from(value));
      }
      const drained = Buffer.concat(chunks);
      expect(drained.equals(original)).toBe(true);
    });

    test('returns a stream honoring a byte range', async () => {
      const key = 'uploads/get-range.txt';
      const original = Buffer.from('0123456789abcdef');
      await provider.putObject({
        key,
        body: original,
        contentType: 'text/plain',
      });

      const result = await provider.getObject({
        key,
        range: { start: 4, end: 7 }, // "4567"
      });
      const reader = (result as ReadableStream<Uint8Array>).getReader();
      const chunks: Buffer[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(Buffer.from(value));
      }
      const drained = Buffer.concat(chunks);
      // Range is inclusive of start + end (4-7 = bytes 4, 5, 6, 7 = "4567")
      expect(drained.toString('utf-8')).toBe('4567');
    });
  });

  describe('deleteObject', () => {
    test('removes the file', async () => {
      const key = 'uploads/delete-test.txt';
      await provider.putObject({
        key,
        body: Buffer.from('delete me'),
        contentType: 'text/plain',
      });

      const expectedPath = path.join(tempDir, key);
      expect(existsSync(expectedPath)).toBe(true);

      await provider.deleteObject(key);

      expect(existsSync(expectedPath)).toBe(false);
    });

    test('does NOT throw when the file does not exist (best-effort)', async () => {
      const key = 'uploads/never-existed.txt';
      // Should resolve without throwing
      await provider.deleteObject(key);
    });

    test('removes only the targeted file (not sibling files)', async () => {
      const targetKey = 'uploads/target.txt';
      const siblingKey = 'uploads/sibling.txt';

      await provider.putObject({
        key: targetKey,
        body: Buffer.from('target'),
        contentType: 'text/plain',
      });
      await provider.putObject({
        key: siblingKey,
        body: Buffer.from('sibling'),
        contentType: 'text/plain',
      });

      await provider.deleteObject(targetKey);

      const targetExists = await provider.objectExists(targetKey);
      const siblingExists = await provider.objectExists(siblingKey);
      expect(targetExists).toBe(false);
      expect(siblingExists).toBe(true);
    });
  });

  describe('uploadStream', () => {
    test('streams a NodeJS.Readable into a file WITHOUT buffering the entire body', async () => {
      const key = 'uploads/stream-node.txt';
      const expectedContent = 'streamed from a NodeJS stream';

      // Create a NodeJS.ReadableStream from a string
      const nodeStream = Readable.from([expectedContent]);

      await provider.uploadStream(key, nodeStream);

      const expectedPath = path.join(tempDir, key);
      expect(existsSync(expectedPath)).toBe(true);

      const contents = await readFile(expectedPath, 'utf-8');
      expect(contents).toBe(expectedContent);
    });

    test('streams a web ReadableStream into a file', async () => {
      const key = 'uploads/stream-web.txt';
      const expectedContent = 'streamed from a web ReadableStream';

      const webStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(expectedContent));
          controller.close();
        },
      });

      await provider.uploadStream(key, webStream);

      const expectedPath = path.join(tempDir, key);
      expect(existsSync(expectedPath)).toBe(true);

      const contents = await readFile(expectedPath, 'utf-8');
      expect(contents).toBe(expectedContent);
    });

    test('file size matches the input stream byte length (no buffering truncation)', async () => {
      const key = 'uploads/stream-size.txt';
      const payload = Buffer.from('x'.repeat(1024)); // 1 KB
      const nodeStream = Readable.from([payload]);

      await provider.uploadStream(key, nodeStream);

      const expectedPath = path.join(tempDir, key);
      const stats = statSync(expectedPath);
      expect(stats.size).toBe(payload.length);
    });

    test('creates nested directories automatically', async () => {
      const key = 'uploads/nested/stream.txt';
      const nodeStream = Readable.from(['nested']);

      await provider.uploadStream(key, nodeStream);

      const expectedPath = path.join(tempDir, key);
      expect(existsSync(expectedPath)).toBe(true);
    });

    test('returns the key in the result', async () => {
      const key = 'uploads/stream-return-key.txt';
      const nodeStream = Readable.from(['test']);

      const result = await provider.uploadStream(key, nodeStream);
      expect(result.key).toBe(key);
    });

    test('handles a stream with multiple chunks', async () => {
      const key = 'uploads/stream-multi-chunk.txt';
      const chunks = ['chunk1-', 'chunk2-', 'chunk3'];
      const expectedContent = chunks.join('');
      const nodeStream = Readable.from(chunks);

      await provider.uploadStream(key, nodeStream);

      const expectedPath = path.join(tempDir, key);
      const contents = await readFile(expectedPath, 'utf-8');
      expect(contents).toBe(expectedContent);
    });

    test('rejects paths that escape the upload root (path traversal)', async () => {
      const maliciousKey = '../../../tmp/escape.txt';
      const nodeStream = Readable.from(['evil']);

      await expect(provider.uploadStream(maliciousKey, nodeStream)).rejects.toThrow(
        /escapes upload root/
      );
    });
  });

  describe('getObjectStream', () => {
    test('returns a web ReadableStream', async () => {
      const key = 'uploads/get-stream.txt';
      const original = Buffer.from('stream me back');
      await provider.putObject({
        key,
        body: original,
        contentType: 'text/plain',
      });

      const stream = await provider.getObjectStream(key);
      expect(stream).toBeInstanceOf(ReadableStream);

      const reader = stream.getReader();
      const chunks: Buffer[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(Buffer.from(value));
      }
      const drained = Buffer.concat(chunks);
      expect(drained.equals(original)).toBe(true);
    });

    test('honors a byte range', async () => {
      const key = 'uploads/get-stream-range.txt';
      const original = Buffer.from('0123456789abcdef');
      await provider.putObject({
        key,
        body: original,
        contentType: 'text/plain',
      });

      const stream = await provider.getObjectStream(key, { start: 0, end: 3 });
      const reader = stream.getReader();
      const chunks: Buffer[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(Buffer.from(value));
      }
      const drained = Buffer.concat(chunks);
      // Range is inclusive — bytes 0-3 = "0123"
      expect(drained.toString('utf-8')).toBe('0123');
    });
  });

  describe('getPublicUrl', () => {
    test('returns null for local provider (files are not public)', () => {
      const url = provider.getPublicUrl('uploads/anything.txt');
      expect(url).toBeNull();
    });
  });

  describe('name', () => {
    test('is "local"', () => {
      expect(provider.name).toBe('local');
    });
  });

  describe('createDownloadUrl', () => {
    test('returns a relative URL pointing at /api/assets/by-key/', async () => {
      const key = 'uploads/download-me.txt';
      const url = await provider.createDownloadUrl({ key });
      expect(url).toContain('/api/assets/by-key/');
      expect(url).toContain(encodeURIComponent(key));
    });
  });

  describe('createUploadUrl', () => {
    test('returns a JWT-signed URL pointing at /api/assets/upload-direct', async () => {
      const key = 'uploads/upload-me.txt';
      const result = await provider.createUploadUrl({
        key,
        contentType: 'text/plain',
        contentLength: 11, // V4-S1: actual file size, signed into the token
      });
      expect(result.url).toContain('/api/assets/upload-direct');
      expect(result.url).toContain('token=');
      expect(result.method).toBe('POST');
      expect(result.key).toBe(key);
      expect(result.headers).toHaveProperty('Content-Type');
    });
  });

  describe('round-trip: put → exists → get → delete → !exists', () => {
    test('full lifecycle of an object', async () => {
      const key = 'uploads/lifecycle.txt';
      const payload = Buffer.from('lifecycle payload');

      // Initially absent
      expect(await provider.objectExists(key)).toBe(false);

      // put
      await provider.putObject({ key, body: payload, contentType: 'text/plain' });

      // Now exists
      expect(await provider.objectExists(key)).toBe(true);

      // get returns the same bytes
      const stream = await provider.getObject({ key });
      const reader = (stream as ReadableStream<Uint8Array>).getReader();
      const chunks: Buffer[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(Buffer.from(value));
      }
      const drained = Buffer.concat(chunks);
      expect(drained.equals(payload)).toBe(true);

      // delete
      await provider.deleteObject(key);

      // Now absent again
      expect(await provider.objectExists(key)).toBe(false);
    });
  });
});
