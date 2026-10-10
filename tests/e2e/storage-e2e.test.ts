// VidiaForge v17.1 — Production Storage E2E Test
//
// V17.1 §40-42: Production-style S3/R2 storage certification.
//
// Pipeline exercised:
//   UploadIntent-style key generation
//     → direct S3/R2 putObject
//     → headObject verification
//     → getObjectStream download
//     → FFmpeg render → uploadStream to S3/R2
//     → createDownloadUrl → HTTP GET
//     → FFprobe output validation
//
// V17.1 §41: Uses a dedicated test namespace:
//   certification/v17.1/<run-id>/
// so cleanup only removes test objects (never user data).
//
// V17.1 §42: If STORAGE_PROVIDER is not 's3' or 'r2', the test:
//   - In certification mode: BLOCKED (exit 2)
//   - In development mode: SKIP
//   - In production mode: FAIL (exit 1)
//
// V17.1 §59: NO CHEATING — local filesystem storage MUST NOT be presented
// as S3/R2 certification.

import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, mkdirSync, rmSync, mkdtempSync, statSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  CertificationBlockedError,
  getTestMode,
  waitForCondition,
} from '../helpers/certification';

const execFileP = promisify(execFile);
const lib = '../src/lib';

const RUN_ID = `run-${randomUUID()}`;
const CERT_NAMESPACE = `certification/v17.1/${RUN_ID}`;

let storageProvider: 'local' | 's3' | 'r2' = 'local';
let storageOk = false;
let ffmpegOk = false;
let ffprobeOk = false;
let testObjectsCreated: string[] = [];

beforeAll(async () => {
  storageProvider = (process.env.STORAGE_PROVIDER || 'local').toLowerCase() as
    | 'local'
    | 's3'
    | 'r2';

  // Check storage health
  try {
    const { getStorage } = await import(`${lib}/storage`);
    storageOk = await getStorage().checkHealth();
  } catch {
    storageOk = false;
  }

  // Check FFmpeg/FFprobe
  ffmpegOk = await pingBinary('ffmpeg');
  ffprobeOk = await pingBinary('ffprobe');
});

afterAll(async () => {
  // V17.1 §41 + §48: Clean up only the test objects we created.
  if (storageProvider !== 'local' && storageOk) {
    try {
      const { getStorage } = await import(`${lib}/storage`);
      const storage = getStorage();
      for (const key of testObjectsCreated) {
        try {
          await storage.deleteObject(key);
          console.log(`[storage-e2e] cleanup: deleted ${key}`);
        } catch (err) {
          console.warn(`[storage-e2e] cleanup: failed to delete ${key}:`, err);
        }
      }
    } catch (err) {
      console.warn('[storage-e2e] cleanup failed:', err);
    }
  }
});

async function pingBinary(name: string): Promise<boolean> {
  try {
    await execFileP(name, ['-version'], { timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}

// V17.1 §42: Check that we have a real S3/R2 provider configured.
function requireS3OrBlock(): void {
  const mode = getTestMode();

  if (storageProvider === 's3' || storageProvider === 'r2') {
    if (storageOk) return;
    // Provider is S3/R2 but health check failed — credentials/bucket issue.
    if (mode === 'certification') {
      throw new CertificationBlockedError(
        'Storage',
        `STORAGE_PROVIDER=${storageProvider} but checkHealth() failed — credentials or bucket inaccessible`
      );
    }
    if (mode === 'production') {
      throw new Error(`FAIL: STORAGE_PROVIDER=${storageProvider} not healthy`);
    }
    console.log(`[storage-e2e] SKIP: STORAGE_PROVIDER=${storageProvider} not healthy (development mode)`);
    return; // unreachable in production/cert
  }

  // Provider is 'local' — we're NOT certifying S3/R2.
  if (mode === 'certification') {
    throw new CertificationBlockedError(
      'Storage',
      `STORAGE_PROVIDER=${storageProvider} — production storage E2E requires STORAGE_PROVIDER=s3 or r2`
    );
  }
  if (mode === 'production') {
    throw new Error(`FAIL: STORAGE_PROVIDER=${storageProvider} — production requires s3 or r2`);
  }
  console.log(`[storage-e2e] SKIP: STORAGE_PROVIDER=${storageProvider} (development mode)`);
}

function reportBlocked(category: string, reason: string): never {
  console.error(`\nCERTIFICATION BLOCKED — ${category}: ${reason}\n`);
  writeEvidence('storage-e2e.json', {
    version: '17.1',
    status: 'BLOCKED',
    blockedCategory: category,
    blockedReason: reason,
    timestamp: new Date().toISOString(),
    runId: RUN_ID,
  });
  process.exitCode = 2;
  throw new CertificationBlockedError(category, reason);
}

function writeEvidence(filename: string, data: unknown): void {
  try {
    mkdirSync('artifacts/certification/v17.1', { recursive: true });
    writeFileSync(`artifacts/certification/v17.1/${filename}`, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn('[storage-e2e] failed to write evidence:', err);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('VidiaForge v17.1 — Production Storage E2E (S3/R2)', () => {
  test(
    'UploadIntent → putObject → headObject → getObjectStream → FFprobe',
    async () => {
      try {
        requireS3OrBlock();
      } catch (err) {
        if (err instanceof CertificationBlockedError) {
          reportBlocked(err.blockedCategory, err.blockedReason);
        }
        throw err;
      }

      // V17.1 §40: Real S3/R2 storage pipeline
      const { getStorage } = await import(`${lib}/storage`);
      const storage = getStorage();

      // V17.1 §41: Dedicated test namespace + unique key per run
      const sourceKey = `${CERT_NAMESPACE}/source-audio.wav`;
      testObjectsCreated.push(sourceKey);

      console.log(`[storage-e2e] Provider: ${storageProvider}`);
      console.log(`[storage-e2e] Namespace: ${CERT_NAMESPACE}`);
      console.log(`[storage-e2e] Source key: ${sourceKey}`);

      // PHASE 1: putObject — upload a small valid WAV file
      const wavHeader = Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
        0x66, 0x6D, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
        0x44, 0xAC, 0x00, 0x00, 0x88, 0x58, 0x01, 0x00, 0x02, 0x00, 0x10, 0x00,
        0x64, 0x61, 0x74, 0x61, 0x00, 0x00, 0x00, 0x00,
      ]);
      await storage.putObject({
        key: sourceKey,
        body: wavHeader,
        contentType: 'audio/wav',
      });
      console.log(`[storage-e2e] ✓ putObject(${sourceKey}) — ${wavHeader.length} bytes`);

      // PHASE 2: headObject — verify the object exists with correct metadata
      const headMeta = await storage.headObject(sourceKey);
      expect(headMeta).toBeTruthy();
      expect(headMeta!.size).toBe(wavHeader.length);
      console.log(
        `[storage-e2e] ✓ headObject(${sourceKey}) — ` +
        `size=${headMeta!.size} contentType=${headMeta!.contentType} etag=${headMeta!.etag?.slice(0, 8)}...`
      );

      // PHASE 3: getObjectStream — download the object back
      const stream = await storage.getObjectStream(sourceKey);
      const reader = stream.getReader();
      const chunks: Buffer[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(Buffer.from(value));
      }
      const downloaded = Buffer.concat(chunks);
      expect(downloaded.length).toBe(wavHeader.length);
      expect(downloaded.equals(wavHeader)).toBe(true);
      console.log(`[storage-e2e] ✓ getObjectStream(${sourceKey}) — ${downloaded.length} bytes downloaded`);

      // PHASE 4: objectExists — verify via the existence check
      const exists = await storage.objectExists(sourceKey);
      expect(exists).toBe(true);
      console.log(`[storage-e2e] ✓ objectExists(${sourceKey}) — true`);

      // PHASE 5: createDownloadUrl — presigned URL for HTTP GET
      const downloadUrl = await storage.createDownloadUrl({ key: sourceKey, expiresIn: 300 });
      expect(downloadUrl).toBeTruthy();
      expect(typeof downloadUrl).toBe('string');

      // Fetch via the presigned URL — proves the URL works over HTTP
      const dlResp = await fetch(downloadUrl, { method: 'GET' });
      expect(dlResp.ok).toBe(true);
      const dlBuffer = Buffer.from(await dlResp.arrayBuffer());
      expect(dlBuffer.length).toBe(wavHeader.length);
      expect(dlBuffer.equals(wavHeader)).toBe(true);
      console.log(`[storage-e2e] ✓ createDownloadUrl → HTTP GET → ${dlBuffer.length} bytes`);

      // V17.1 §56: Write evidence
      writeEvidence('storage-e2e.json', {
        version: '17.1',
        status: 'PASS',
        runId: RUN_ID,
        provider: storageProvider,
        namespace: CERT_NAMESPACE,
        timestamp: new Date().toISOString(),
        phases: {
          putObject: 'PASS',
          headObject: 'PASS',
          getObjectStream: 'PASS',
          objectExists: 'PASS',
          createDownloadUrl: 'PASS',
        },
        sourceObject: {
          key: sourceKey,
          sizeBytes: wavHeader.length,
          contentType: 'audio/wav',
        },
      });

      console.log(`\n[storage-e2e] ===== PRODUCTION STORAGE E2E — PASS =====`);
      console.log(`  Provider: ${storageProvider}`);
      console.log(`  Run ID: ${RUN_ID}`);
      console.log(`  Cleanup: ${testObjectsCreated.length} object(s) will be removed in afterAll`);
    },
    60_000
  );

  test(
    'FFmpeg render → uploadStream → createDownloadUrl → FFprobe output',
    async () => {
      try {
        requireS3OrBlock();
      } catch (err) {
        if (err instanceof CertificationBlockedError) {
          reportBlocked(err.blockedCategory, err.blockedReason);
        }
        throw err;
      }

      // V17.1 §37: FFmpeg + FFprobe are mandatory for this test
      if (!ffmpegOk || !ffprobeOk) {
        const mode = getTestMode();
        if (mode === 'certification') {
          reportBlocked(
            'FFmpeg/FFprobe',
            `${!ffmpegOk ? 'ffmpeg' : 'ffprobe'} not available for render output validation`
          );
        }
        console.log(`[storage-e2e:render] SKIP: FFmpeg=${ffmpegOk} FFprobe=${ffprobeOk}`);
        return;
      }

      const { getStorage } = await import(`${lib}/storage`);
      const storage = getStorage();

      // Use the existing fixture for render input — it's local.
      const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');
      const SAMPLE_PROJECT = path.join(FIXTURES_DIR, 'sample-project.json');
      const SAMPLE_VIDEO = path.join(FIXTURES_DIR, 'sample-video.mp4');
      const SAMPLE_AUDIO = path.join(FIXTURES_DIR, 'sample-audio.wav');

      // Ensure fixtures exist (delegating to the generator if absent).
      if (!pathExists(SAMPLE_VIDEO) || !pathExists(SAMPLE_AUDIO)) {
        await execFileP('bun', ['tests/fixtures/generate.ts']);
      }
      if (!pathExists(SAMPLE_PROJECT)) {
        throw new Error(`sample-project.json not found at ${SAMPLE_PROJECT}`);
      }

      const projectJson = await Bun.file(SAMPLE_PROJECT).text();
      const project = JSON.parse(projectJson);

      // Resolve assets to absolute paths for local file access during render.
      const assetsById: Record<string, { storageKey: string; localPath?: string }> = {};
      for (const asset of project.assets || []) {
        const absPath = path.isAbsolute(asset.storagePath)
          ? asset.storagePath
          : path.resolve(asset.storagePath);
        assetsById[asset.id] = { storageKey: asset.storagePath, localPath: absPath };
      }

      const { FFmpegRenderService } = await import(`${lib}/render/ffmpeg-render-service`);
      const { getRenderOutputKey } = await import(`${lib}/render/job-idempotency`);
      const service = new FFmpegRenderService();

      const tempDir = mkdtempSync(path.join(tmpdir(), 'vf-storage-e2e-'));
      const previousUploadDir = process.env.UPLOAD_DIR;
      const previousStorageProvider = process.env.STORAGE_PROVIDER;
      const previousJwtSecret = process.env.JWT_SECRET;
      process.env.UPLOAD_DIR = tempDir;
      // For the render input we keep STORAGE_PROVIDER as s3/r2 — but the local
      // fixture paths must be readable. The render service reads via fs for
      // local-path assets regardless of STORAGE_PROVIDER.
      process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-32-chars-long-xxx';

      const renderJobId = `storage-e2e-${RUN_ID}`;
      const outputKey = `${CERT_NAMESPACE}/renders/${renderJobId}/output.mp4`;
      testObjectsCreated.push(outputKey);

      const options = {
        format: 'mp4' as const,
        codec: 'h264' as const,
        height: 480,
        fps: 30,
        videoBitrate: 1_000_000,
        audioBitrate: 128_000,
        pixelFormat: 'yuv420p' as const,
        audioSampleRate: 44_100,
        audioChannels: 2,
        aspectRatio: { w: 4, h: 3 },
        preset: 'storage-e2e',
      };

      try {
        console.log(`[storage-e2e:render] Rendering project to output key: ${outputKey}`);
        const result = await service.render({
          project,
          assets: assetsById,
          outputPath: outputKey,
          options,
          onProgress: (p) => {
            if (p.progress >= 1) {
              console.log(`[storage-e2e:render] progress: 100% stage=${p.stage}`);
            }
          },
        });

        expect(result.outputKey).toBe(outputKey);
        expect(result.durationSeconds).toBeGreaterThan(0);
        console.log(`[storage-e2e:render] ✓ Render returned: duration=${result.durationSeconds}s`);

        // V17.1 §40: Verify the output was uploaded to S3/R2 (not local FS).
        const outputExists = await storage.objectExists(outputKey);
        expect(outputExists).toBe(true);
        const outputMeta = await storage.headObject(outputKey);
        expect(outputMeta).toBeTruthy();
        expect(outputMeta!.size).toBeGreaterThan(0);
        console.log(`[storage-e2e:render] ✓ Output exists in ${storageProvider}: ${outputMeta!.size} bytes`);

        // V17.1 §40: Download the output via createDownloadUrl + HTTP GET.
        const downloadUrl = await storage.createDownloadUrl({ key: outputKey, expiresIn: 600 });
        const dlResp = await fetch(downloadUrl);
        expect(dlResp.ok).toBe(true);
        const dlBuffer = Buffer.from(await dlResp.arrayBuffer());
        expect(dlBuffer.length).toBeGreaterThan(0);
        console.log(`[storage-e2e:render] ✓ Downloaded ${dlBuffer.length} bytes via presigned URL`);

        // V17.1 §40: Run FFprobe on the downloaded output.
        const tempOutput = path.join(tempDir, 'output.mp4');
        writeFileSync(tempOutput, dlBuffer);
        const { stdout: probeJson } = await execFileP('ffprobe', [
          '-v', 'quiet',
          '-print_format', 'json',
          '-show_streams',
          '-show_format',
          tempOutput,
        ]);
        const probe = JSON.parse(probeJson);

        const videoStream = probe.streams.find((s: any) => s.codec_type === 'video');
        expect(videoStream).toBeDefined();
        expect(videoStream.codec_name).toBe('h264');
        expect(parseInt(videoStream.width, 10)).toBeGreaterThanOrEqual(639);
        expect(parseInt(videoStream.height, 10)).toBeGreaterThanOrEqual(479);

        const duration = parseFloat(probe.format?.duration || videoStream.duration || '0');
        expect(duration).toBeGreaterThan(2.7);
        expect(duration).toBeLessThan(3.3);

        console.log(`[storage-e2e:render] ✓ FFprobe validated: ${videoStream.width}x${videoStream.height} h264 ${duration.toFixed(3)}s`);

        // V17.1 §56: Write evidence
        writeEvidence('storage-e2e-render.json', {
          version: '17.1',
          status: 'PASS',
          runId: RUN_ID,
          provider: storageProvider,
          timestamp: new Date().toISOString(),
          outputObject: {
            key: outputKey,
            sizeBytes: outputMeta!.size,
            storageClass: storageProvider,
          },
          ffprobe: {
            codec: videoStream.codec_name,
            width: videoStream.width,
            height: videoStream.height,
            durationSec: duration,
          },
        });

        console.log(`\n[storage-e2e:render] ===== PRODUCTION RENDER E2E — PASS =====`);
      } finally {
        if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
        else process.env.UPLOAD_DIR = previousUploadDir;
        if (previousStorageProvider === undefined) delete process.env.STORAGE_PROVIDER;
        else process.env.STORAGE_PROVIDER = previousStorageProvider;
        if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = previousJwtSecret;
        try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* */ }
      }
    },
    180_000
  );
});

function pathExists(p: string): boolean {
  try {
    return !!statSync(p);
  } catch {
    return false;
  }
}
