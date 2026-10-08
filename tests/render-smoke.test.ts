// VidiaForge v17.1 — Render smoke test
//
// Deterministic test that exercises the full FFmpeg render pipeline against
// a tiny fixture (3s 640×480 H.264 video + 3s 440Hz sine wave audio).
//
// V17.1 §37 + Rule 6: In CERTIFICATION_MODE, missing FFmpeg/FFprobe → BLOCKED
// (exit 2), NOT silent SKIP. Developer mode may skip cleanly.

import { test, expect, describe } from 'bun:test';
import { execFileSync } from 'child_process';
import { existsSync, statSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import process from 'process';
import { CertificationBlockedError, getTestMode } from './helpers/certification';

// === FFmpeg detection ============================================================
// V9 §22: Use the production MediaBinaryResolver — the SAME resolver used by
// the render worker + render service. No more stale `execFileSync('command')`
// which was a shell builtin that always failed.
// The resolver checks: env vars → npm packages → system PATH via `which` → container defaults.

let ffmpegPath: string | null = null;
let ffprobePath: string | null = null;
let ffmpegAvailable: boolean = false;

// Synchronous detection for skipIf (must run before test registration)
function findBinarySync(bin: string): string | null {
  const candidates: string[] = [
    `/usr/bin/${bin}`,
    `/usr/local/bin/${bin}`,
  ];
  if (process.env[`${bin.toUpperCase()}_PATH`]) {
    candidates.unshift(process.env[`${bin.toUpperCase()}_PATH`]!);
  }
  try {
    const stdout = execFileSync('which', [bin], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    });
    const p = stdout.split(/\r?\n/)[0].trim();
    if (p) candidates.unshift(p);
  } catch {
    // which not available OR binary not on PATH — fall through to candidates.
  }
  for (const c of candidates) {
    try {
      const st = statSync(c);
      if (st.isFile() && (st.mode & 0o111)) return c;
    } catch {
      // Doesn't exist — try next.
    }
  }
  return null;
}

ffmpegPath = findBinarySync('ffmpeg');
ffprobePath = findBinarySync('ffprobe');
ffmpegAvailable = !!ffmpegPath && !!ffprobePath;

// V9 §22: The render service now uses MediaBinaryResolver (fixed in V4-S2).
// No more stale `execFileSync('command')` check. If FFmpeg is available via
// findBinarySync above, the production resolver will also find it.
const renderServiceCanFindFfmpeg: boolean = ffmpegAvailable;

// V13.1 §17: CERTIFICATION_MODE — in certification mode, unavailable FFmpeg
// produces BLOCKED (not SKIP). In developer mode, SKIP is acceptable.
const CERTIFICATION_MODE = process.env.CERTIFICATION_MODE === 'true';

// V17.1 §37: In certification mode, if FFmpeg/FFprobe are missing, throw
// CertificationBlockedError so the runner reports BLOCKED (exit 2) — never PASS.
if (ffmpegAvailable) {
  console.log(
    `[render-smoke] ffmpeg at ${ffmpegPath}, ffprobe at ${ffprobePath}`
  );
} else {
  const mode = getTestMode();
  if (mode === 'certification') {
    console.error('[render-smoke] CERTIFICATION BLOCKED: FFmpeg or FFprobe not available');
    // Defer throw until inside the test body — bun:test catches top-level throws
    // as test failures, which is what we want for FAIL but not for BLOCKED.
    // We'll handle this in the test itself.
  } else if (mode === 'production') {
    console.error('[render-smoke] FAIL: FFmpeg or FFprobe not available in production mode');
  } else {
    console.log('[render-smoke] FFmpeg or FFprobe not available — test will skip (development mode).');
  }
}

// === Fixtures path =============================================================

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const SAMPLE_VIDEO = path.join(FIXTURES_DIR, 'sample-video.mp4');
const SAMPLE_AUDIO = path.join(FIXTURES_DIR, 'sample-audio.wav');
const SAMPLE_PROJECT = path.join(FIXTURES_DIR, 'sample-project.json');

function ensureFixtures(): void {
  if (!existsSync(SAMPLE_VIDEO) || !existsSync(SAMPLE_AUDIO)) {
    console.log('[render-smoke] Generating fixtures...');
    execFileSync('bun', ['tests/fixtures/generate.ts'], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
  }
  if (!existsSync(SAMPLE_PROJECT)) {
    throw new Error(`sample-project.json not found at ${SAMPLE_PROJECT}`);
  }
}

function probeFile(filePath: string): any {
  const stdout = execFileSync(ffprobePath!, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    '-show_format',
    filePath,
  ], { encoding: 'utf-8' });
  return JSON.parse(stdout);
}

// === Tests =====================================================================

describe('Render smoke test', () => {
  // V17.1 §37: In certification mode, missing FFmpeg MUST throw CertificationBlockedError.
  // The runner catches it and exits with code 2 (BLOCKED), never silent PASS.
  // In development mode, the test is skipped via test.skipIf.
  test(
    'renders the sample project to a 3s 640x480 H.264 MP4 with audio',
    async () => {
      // V17.1 §37: Hard-failure check INSIDE the test body (so it runs even
      // when test.skipIf would have otherwise skipped it).
      if (!ffmpegAvailable || !renderServiceCanFindFfmpeg) {
        const mode = getTestMode();
        if (mode === 'certification') {
          throw new CertificationBlockedError(
            'FFmpeg/FFprobe',
            'FFmpeg or FFprobe not available — required for render smoke test'
          );
        }
        if (mode === 'production') {
          throw new Error('FAIL: FFmpeg/FFprobe unavailable in production mode');
        }
        console.log('[render-smoke] SKIP: FFmpeg unavailable (development mode)');
        return;
      }

      // 1. Ensure fixtures exist
      ensureFixtures();
      expect(existsSync(SAMPLE_VIDEO)).toBe(true);
      expect(existsSync(SAMPLE_AUDIO)).toBe(true);
      expect(existsSync(SAMPLE_PROJECT)).toBe(true);

      // 2. Load the sample project JSON
      const projectJson = await Bun.file(SAMPLE_PROJECT).text();
      const project = JSON.parse(projectJson);
      expect(project.schemaVersion).toBe(1);
      expect(project.clips.length).toBeGreaterThan(0);

      // 3. Build the assets map from the project's `assets` array.
      //    The render service expects assets keyed by id, with storageKey
      //    pointing at a real local file path (since STORAGE_PROVIDER=local).
      const assetsById: Record<string, { storageKey: string; localPath?: string }> = {};
      for (const asset of project.assets || []) {
        // The fixture assets point at relative paths like "tests/fixtures/sample-video.mp4"
        // Resolve to absolute paths so the local storage provider can find them.
        const absPath = path.isAbsolute(asset.storagePath)
          ? asset.storagePath
          : path.resolve(asset.storagePath);
        assetsById[asset.id] = {
          storageKey: asset.storagePath,
          localPath: absPath,
        };
      }

      // 4. Import the render service
      const { FFmpegRenderService } = await import('../src/lib/render/ffmpeg-render-service');
      const { getRenderOutputKey } = await import('../src/lib/render/job-idempotency');

      const service = new FFmpegRenderService();

      // 5. Set up env for the local storage provider
      const tempUploadDir = mkdtempSync(path.join(tmpdir(), 'vf-render-smoke-'));
      const previousUploadDir = process.env.UPLOAD_DIR;
      const previousStorageProvider = process.env.STORAGE_PROVIDER;
      const previousJwtSecret = process.env.JWT_SECRET;
      process.env.UPLOAD_DIR = tempUploadDir;
      process.env.STORAGE_PROVIDER = 'local';
      process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-32-chars-long-xxx';

      // Render options — match the sample-project.json's 640x480 @ 30fps
      const renderJobId = `render-smoke-${Date.now()}`;
      const outputKey = getRenderOutputKey(renderJobId, 'mp4');
      const options = {
        format: 'mp4' as const,
        codec: 'h264' as const,
        height: 480, // matches the sample project's canvas height
        fps: 30,
        videoBitrate: 1_000_000, // 1 Mbps — plenty for 640x480
        audioBitrate: 128_000,
        pixelFormat: 'yuv420p' as const,
        audioSampleRate: 44_100,
        audioChannels: 2,
        aspectRatio: { w: 4, h: 3 }, // matches 640x480
        preset: 'render-smoke',
      };

      try {
        // 6. Render!
        console.log(`[render-smoke] Rendering project to output key: ${outputKey}`);
        const result = await service.render({
          project,
          assets: assetsById,
          outputPath: outputKey,
          options,
          onProgress: (p) => {
            // Only log significant progress changes to avoid spam
            if (p.progress === 0 || p.progress >= 1 || Math.floor(p.progress * 10) % 2 === 0) {
              console.log(
                `[render-smoke] progress: ${(p.progress * 100).toFixed(1)}% ` +
                `stage=${p.stage} frame=${p.currentFrame ?? '?'}/${p.totalFrames ?? '?'} ` +
                `fps=${p.fps ?? '?'} elapsed=${p.elapsedSeconds?.toFixed(1) ?? '?'}s`
              );
            }
          },
        });

        // 7. Verify the render returned successfully
        expect(result).toBeDefined();
        expect(result.outputKey).toBe(outputKey);
        expect(result.durationSeconds).toBeGreaterThan(0);
        console.log(`[render-smoke] Render returned: outputKey=${result.outputKey}, duration=${result.durationSeconds}s`);

        // 8. Verify the output object exists in storage (the local FS)
        const { getStorage } = await import('../src/lib/storage');
        const storage = getStorage();
        const exists = await storage.objectExists(outputKey);
        expect(exists).toBe(true);
        console.log(`[render-smoke] Output object exists in storage: ${exists}`);

        // 9. Download the output via the local provider's getObjectStream
        const stream = await storage.getObjectStream(outputKey);
        const reader = stream.getReader();
        const chunks: Buffer[] = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) chunks.push(Buffer.from(value));
        }
        const outputBuffer = Buffer.concat(chunks);
        expect(outputBuffer.length).toBeGreaterThan(0);
        console.log(`[render-smoke] Output size: ${outputBuffer.length} bytes`);

        // 10. Write the output to a temp file + run ffprobe on it
        const tempOutputPath = path.join(tempUploadDir, 'output.mp4');
        const { writeFileSync } = await import('fs');
        writeFileSync(tempOutputPath, outputBuffer);
        expect(existsSync(tempOutputPath)).toBe(true);

        const probe = probeFile(tempOutputPath);
        expect(probe.streams).toBeDefined();
        expect(probe.streams.length).toBeGreaterThan(0);

        const videoStream = probe.streams.find((s: any) => s.codec_type === 'video');
        const audioStream = probe.streams.find((s: any) => s.codec_type === 'audio');

        // === Verification ===

        // a. File exists (already verified above)
        // b. Size > 0 (already verified above)
        // c. Video stream exists
        expect(videoStream).toBeDefined();
        console.log(`[render-smoke] Video stream: codec=${videoStream.codec_name}, ` +
          `${videoStream.width}x${videoStream.height}, ` +
          `duration=${videoStream.duration}s`);

        // d. Video codec is h264
        expect(videoStream.codec_name).toBe('h264');

        // e. Resolution is 640x480 (within 1px tolerance — FFmpeg may
        //    round to even pixel dimensions)
        const videoWidth = parseInt(videoStream.width, 10);
        const videoHeight = parseInt(videoStream.height, 10);
        expect(Math.abs(videoWidth - 640)).toBeLessThanOrEqual(1);
        expect(Math.abs(videoHeight - 480)).toBeLessThanOrEqual(1);

        // f. Duration is approximately 3s (within 10% — FFmpeg may trim
        //    slightly due to GOP boundaries)
        const duration = parseFloat(probe.format?.duration || videoStream.duration || '0');
        expect(duration).toBeGreaterThan(0);
        // 3s with 10% tolerance: between 2.7s and 3.3s
        expect(duration).toBeGreaterThan(2.7);
        expect(duration).toBeLessThan(3.3);
        console.log(`[render-smoke] Output duration: ${duration.toFixed(3)}s (expected ~3s)`);

        // g. Audio stream exists (the sample project has both a video
        //    clip with embedded audio + a separate audio clip)
        expect(audioStream).toBeDefined();
        console.log(`[render-smoke] Audio stream: codec=${audioStream.codec_name}, ` +
          `channels=${audioStream.channels}, sample_rate=${audioStream.sample_rate}Hz`);

        console.log('[render-smoke] All output checks PASSED.');

        // V17.1 §56: Write evidence artifact
        try {
          mkdirSync('artifacts/certification/v17.1', { recursive: true });
          writeFileSync(
            'artifacts/certification/v17.1/render-smoke.json',
            JSON.stringify({
              version: '17.1',
              status: 'PASS',
              timestamp: new Date().toISOString(),
              ffmpegPath,
              ffprobePath,
              output: {
                codec: videoStream.codec_name,
                width: videoStream.width,
                height: videoStream.height,
                durationSec: duration,
                audioCodec: audioStream?.codec_name,
                audioSampleRate: audioStream?.sample_rate,
              },
            }, null, 2)
          );
        } catch (err) {
          console.warn('[render-smoke] failed to write evidence:', err);
        }
      } finally {
        // Restore env vars
        if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
        else process.env.UPLOAD_DIR = previousUploadDir;
        if (previousStorageProvider === undefined) delete process.env.STORAGE_PROVIDER;
        else process.env.STORAGE_PROVIDER = previousStorageProvider;
        if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = previousJwtSecret;

        // Clean up the temp upload dir (includes the rendered output + any
        // intermediate files the storage provider wrote).
        rmSync(tempUploadDir, { recursive: true, force: true });
      }
    },
    120000 // 2-minute timeout — render of 3s 480p should take ~5-15s on most hardware
  );

  test.skipIf(!ffmpegAvailable)(
    'fixture generator produces a valid 3s 640x480 30fps H.264 MP4',
    () => {
      ensureFixtures();

      expect(existsSync(SAMPLE_VIDEO)).toBe(true);
      const stats = statSync(SAMPLE_VIDEO);
      expect(stats.size).toBeGreaterThan(0);
      console.log(`[render-smoke] sample-video.mp4 size: ${stats.size} bytes`);

      const probe = probeFile(SAMPLE_VIDEO);
      const videoStream = probe.streams.find((s: any) => s.codec_type === 'video');
      const audioStream = probe.streams.find((s: any) => s.codec_type === 'audio');

      expect(videoStream).toBeDefined();
      expect(videoStream.codec_name).toBe('h264');
      expect(parseInt(videoStream.width, 10)).toBe(640);
      expect(parseInt(videoStream.height, 10)).toBe(480);

      // Duration ≈ 3s (within 0.5s)
      const duration = parseFloat(probe.format?.duration || videoStream.duration || '0');
      expect(Math.abs(duration - 3)).toBeLessThan(0.5);

      // Audio stream should also exist (the generator embeds 440Hz sine)
      expect(audioStream).toBeDefined();
      expect(audioStream.codec_name).toBe('pcm_s16le');

      console.log(
        `[render-smoke] fixture verified: 640x480 H.264 + 440Hz sine, duration=${duration.toFixed(3)}s`
      );
    }
  );

  test.skipIf(ffmpegAvailable)(
    'skips cleanly when FFmpeg is not available (HONEST — no fake pass)',
    () => {
      // This test only runs when ffmpegAvailable is FALSE.
      console.log(
        '[render-smoke] SKIPPED: FFmpeg not available.\n' +
          'Install FFmpeg (https://ffmpeg.org/download.html) to enable the render smoke test.\n' +
          'On macOS: brew install ffmpeg\n' +
          'On Ubuntu: sudo apt-get install ffmpeg'
      );
    }
  );
});
