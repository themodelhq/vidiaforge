// VidiaForge V19.1.4 — Production Keyframe Render E2E Test
//
// V19.1.4 §13: This test calls the ACTUAL VidiaForge production renderer
// (FFmpegRenderService.render()), NOT standalone FFmpeg commands.
//
// Flow (V19.1.4 §13):
//   create test project (ProjectDocument with X/Y keyframes)
//   → create test media (solid color video via FFmpeg lavfi)
//   → invoke FFmpegRenderService.render() (PRODUCTION PATH)
//   → FFmpeg processes the filter graph built by buildFilterGraph()
//   → MP4 output in storage
//   → FFprobe validation
//   → frame extraction + analysis (verify position changed)
//
// V19.1.4 RULE B: This test does NOT construct FFmpeg commands directly.
// It constructs a ProjectDocument + keyframes, then calls the production
// render service which internally calls buildFilterGraph + FFmpeg.

import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

const execFileP = promisify(execFile);
const FFmpeg = '/usr/bin/ffmpeg';
const FFprobe = '/usr/bin/ffprobe';

let tempDir: string;
let tempUploadDir: string;
let previousUploadDir: string | undefined;
let previousStorageProvider: string | undefined;

beforeAll(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'vf-kf-prod-'));
  tempUploadDir = mkdtempSync(path.join(tmpdir(), 'vf-kf-prod-uploads-'));

  // V19.1.4: Save env vars so we can restore them after the test
  previousUploadDir = process.env.UPLOAD_DIR;
  previousStorageProvider = process.env.STORAGE_PROVIDER;
  process.env.UPLOAD_DIR = tempUploadDir;
  process.env.STORAGE_PROVIDER = 'local';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-32-chars-long-xxx';

  // V19.1.4: Create a 40x40 red test video that will be the "foreground" clip
  // The foreground is a solid red square. We render it as a 1s 40x40 video
  // (shorter duration = faster production render for the test).
  const fgPath = path.join(tempUploadDir, 'keyframe-fg', 'source.mp4');
  mkdirSync(path.dirname(fgPath), { recursive: true });
  await execFileP(FFmpeg, [
    '-y', '-f', 'lavfi',
    '-i', 'color=c=red:s=40x40:d=1:r=15',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-t', '1',
    fgPath,
  ], { timeout: 30_000 });
});

afterAll(() => {
  // V19.1.4 §55: Restore env vars
  if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
  else process.env.UPLOAD_DIR = previousUploadDir;
  if (previousStorageProvider === undefined) delete process.env.STORAGE_PROVIDER;
  else process.env.STORAGE_PROVIDER = previousStorageProvider;

  // V19.1.4 §55: Clean up temp files
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* */ }
  try { rmSync(tempUploadDir, { recursive: true, force: true }); } catch { /* */ }
});

/**
 * V19.1.4 §11: Build a deterministic test project with X/Y keyframes.
 *
 * Canvas: 200×200
 * Foreground: 40×40 red clip with keyframes:
 *   t=0: x=0.10, y=0.50 (left-center)
 *   t=1: x=0.50, y=0.50 (center)
 *   t=2: x=0.90, y=0.50 (right-center)
 *
 * The clip moves LEFT → CENTER → RIGHT over 2 seconds.
 */
function buildKeyframeTestProject(): {
  project: any;
  assets: Record<string, { storageKey: string; localPath?: string }>;
} {
  const assetId = 'kf-fg-asset';
  const storageKey = 'keyframe-fg/source.mp4';
  const localPath = path.join(tempUploadDir, storageKey);

  // V19.1.4 §6: Normalized coordinates (0=left, 0.5=center, 1=right)
  const keyframes = [
    // X keyframes: 0.10 → 0.50 → 0.90 over 0→0.5→1 seconds
    { id: 'kf-x-0', time: 0, property: 'x', value: 0.10, easing: 'linear' as const },
    { id: 'kf-x-1', time: 0.5, property: 'x', value: 0.50, easing: 'linear' as const },
    { id: 'kf-x-2', time: 1, property: 'x', value: 0.90, easing: 'linear' as const },
    // Y keyframes: constant 0.50 (center)
    { id: 'kf-y-0', time: 0, property: 'y', value: 0.50, easing: 'linear' as const },
    { id: 'kf-y-1', time: 1, property: 'y', value: 0.50, easing: 'linear' as const },
  ];

  const clip = {
    id: 'kf-clip-1',
    trackId: 'track-video',
    kind: 'video',
    assetId,
    assetName: 'Red 40x40',
    sourceStart: 0,
    sourceEnd: 1,
    timelineStart: 0,
    duration: 1,
    speed: 1,
    reverse: false,
    frozen: null,
    // V19.1.4 §7: transform holds the BASE transform; keyframes override at time t
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 },
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
    blendMode: 'normal',
    color: {
      exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0,
      whites: 0, blacks: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, hue: 0,
    },
    audio: { volume: 0, pan: 0, fadeIn: 0, fadeOut: 0, muted: true },
    effects: [],
    filters: [],
    transitions: [],
    keyframes,
    masks: [],
    enabled: true,
  };

  const project = {
    schemaVersion: 1,
    project: {
      id: 'kf-test-project',
      name: 'Keyframe Position Test',
      width: 200,
      height: 200,
      fps: 15,
      canvasPreset: '1:1',
      resolution: '480p',
      duration: 1,
    },
    tracks: [
      { id: 'track-video', kind: 'video', name: 'Video', locked: false, hidden: false, solo: false, muted: false, height: 80 },
    ],
    clips: [clip],
    markers: [],
    assets: [
      {
        id: assetId,
        name: 'Red 40x40',
        kind: 'video',
        mimeType: 'video/mp4',
        size: 0,
        storagePath: storageKey,
      },
    ],
  };

  return {
    project,
    assets: {
      [assetId]: { storageKey, localPath },
    },
  };
}

/**
 * V19.1.5 §14: Extract a frame at a specific time + analyze the red pixel
 * distribution to determine the foreground's X position.
 *
 * Uses raw RGB pixel analysis (more reliable than cropdetect which has
 * contrast threshold issues with solid colors on black backgrounds).
 *
 * Returns the center X of red pixels (0..1, where 0=left, 1=right).
 */
async function analyzeFrameRedPosition(framePath: string): Promise<number> {
  // V19.1.5: Extract frame as raw RGB24 + analyze pixel positions
  const rawPath = framePath.replace('.png', '.raw');
  await execFileP(FFmpeg, [
    '-y', '-i', framePath,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24',
    rawPath,
  ], { timeout: 10_000 });

  const { readFileSync } = await import('fs');
  const data = readFileSync(rawPath);
  const width = 200;
  const height = 200;

  // V19.1.5: Scan the center row (Y=100) for red pixels
  const rowY = Math.floor(height / 2);
  const rowStart = rowY * width * 3;
  const redPositions: number[] = [];
  for (let x = 0; x < width; x++) {
    const offset = rowStart + x * 3;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    if (r > 200 && g < 100 && b < 100) {
      redPositions.push(x);
    }
  }

  if (redPositions.length === 0) return 0.5;

  const center = (redPositions[0] + redPositions[redPositions.length - 1]) / 2;
  return center / width;
}

describe('V19.1.4 §13: Production Keyframe Render E2E', () => {
  test(
    'V19.1.4 §11: X position keyframe — LEFT→CENTER→RIGHT via PRODUCTION renderer',
    async () => {
      // V19.1.4 §13: Build the test project with keyframes
      const { project, assets } = buildKeyframeTestProject();

      // V19.1.4 §13: Import the PRODUCTION render service (NOT standalone FFmpeg)
      const { FFmpegRenderService } = await import('../../src/lib/render/ffmpeg-render-service');
      const service = new FFmpegRenderService();

      // V19.1.4 §13: Render via the production path
      const outputKey = `renders/kf-prod-test-${randomUUID()}/output.mp4`;
      const result = await service.render({
        project,
        assets,
        outputPath: outputKey,
        options: {
          format: 'mp4',
          codec: 'h264',
          height: 200,
          fps: 15,
          videoBitrate: 200_000,
          audioBitrate: 64_000,
          pixelFormat: 'yuv420p',
          audioSampleRate: 44_100,
          audioChannels: 2,
          aspectRatio: { w: 1, h: 1 },
          preset: 'kf-test',
        },
        onProgress: (p) => {
          if (p.progress >= 1) {
            console.log(`[kf-prod] render progress: ${Math.round(p.progress * 100)}% stage=${p.stage}`);
          }
        },
      });

      // V19.1.4 §13: Verify the render returned successfully
      expect(result).toBeDefined();
      expect(result.outputKey).toBe(outputKey);
      expect(result.durationSeconds).toBeGreaterThan(0);
      console.log(`[kf-prod] Render complete: outputKey=${result.outputKey}, duration=${result.durationSeconds}s`);

      // V19.1.4 §13: Verify the output exists in storage
      const { getStorage } = await import('../../src/lib/storage');
      const storage = getStorage();
      const outputExists = await storage.objectExists(outputKey);
      expect(outputExists).toBe(true);

      // V19.1.4 §13: Download the output for frame analysis
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

      // Write to temp file for FFprobe + frame extraction
      const outputPath = path.join(tempDir, 'output.mp4');
      writeFileSync(outputPath, outputBuffer);

      // V19.1.4 §13: FFprobe validation
      const { stdout: probeJson } = await execFileP(FFprobe, [
        '-v', 'quiet', '-print_format', 'json',
        '-show_streams', '-show_format',
        outputPath,
      ], { timeout: 10_000 });
      const probe = JSON.parse(probeJson);
      const videoStream = probe.streams.find((s: any) => s.codec_type === 'video');
      expect(videoStream).toBeDefined();
      expect(videoStream.codec_name).toBe('h264');
      expect(parseInt(videoStream.width, 10)).toBe(200);
      expect(parseInt(videoStream.height, 10)).toBe(200);
      const duration = parseFloat(probe.format?.duration || '0');
      expect(duration).toBeGreaterThan(0.8);
      expect(duration).toBeLessThan(1.5);

      console.log('[kf-prod] FFprobe validated: 200x200 H.264, duration=' + duration.toFixed(2) + 's');

      // V19.1.5 §14: Extract frames at t=0.1, t=0.5, t=0.9 + analyze position
      // (avoid exact 0 and 1 which may not have frames at 15fps)
      const positions: number[] = [];
      for (const t of [0.1, 0.5, 0.9]) {
        const framePath = path.join(tempDir, `frame-${t}.png`);
        await execFileP(FFmpeg, [
          '-y', '-ss', String(t), '-i', outputPath,
          '-frames:v', '1', '-f', 'image2', '-vcodec', 'png',
          framePath,
        ], { timeout: 10_000 });
        expect(existsSync(framePath)).toBe(true);
        const posX = await analyzeFrameRedPosition(framePath);
        positions.push(posX);
        console.log(`[kf-prod] Frame at t=${t}s: red X position = ${posX.toFixed(3)}`);
      }

      console.log('[kf-prod] Positions:', positions.map(p => p.toFixed(3)).join(' → '));

      // V19.1.5 §21: HONEST ASSERTIONS — the test MUST FAIL if position doesn't change.
      // V19.1.5 §3: NO FAKE PASS — remove any "we don't falsely claim" logic
      // that returns PASS despite detecting incorrect results.
      //
      // V19.1.5 §13: The keyframe values represent the clip's LEFT edge position
      // (normalized 0..1). The cropdetect/analysis finds the clip's CENTER.
      // For a 40px clip on a 200px canvas:
      //   x=0.10 → left=16, center=36, normalized center=0.18
      //   x=0.50 → left=80, center=100, normalized center=0.50
      //   x=0.90 → left=144, center=164, normalized center=0.82
      // Tolerance: ±0.10 (generous enough for 15fps frame rounding)
      const TOLERANCE = 0.10;

      // V19.1.5 §21: Assert the position CHANGED — not stayed at center
      expect(positions[2]).not.toBeCloseTo(positions[0], 1);

      // V19.1.5 §21: Assert each position is close to expected CENTER position
      // t=0.1: expected center ~0.18 (left edge at 0.10, clip width 40px on 200px canvas)
      expect(Math.abs(positions[0] - 0.18)).toBeLessThan(TOLERANCE);
      // t=0.5: expected center ~0.50
      expect(Math.abs(positions[1] - 0.50)).toBeLessThan(TOLERANCE);
      // t=0.9: expected center ~0.82 (left edge at 0.90)
      expect(Math.abs(positions[2] - 0.82)).toBeLessThan(TOLERANCE);

      console.log('[kf-prod] ✓ All position assertions PASSED — LEFT → CENTER → RIGHT verified');

      // V19.1.5 §45: Write certification evidence
      try {
        mkdirSync('artifacts/certification/v19.1', { recursive: true });
        writeFileSync('artifacts/certification/v19.1/keyframe-production-render-e2e.json', JSON.stringify({
          version: '19.1',
          release: 'VidiaForge V19.1',
          gitSha: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' }).trim(),
          timestamp: new Date().toISOString(),
          status: 'PASS',
          test: 'production-keyframe-render-e2e',
          renderer: 'FFmpegRenderService (production)',
          projectId: 'kf-test-project',
          outputKey: result.outputKey,
          outputDuration: duration,
          outputDimensions: `${videoStream.width}x${videoStream.height}`,
          expected: {
            '0.1s': { x: 0.10, y: 0.50 },
            '0.5s': { x: 0.50, y: 0.50 },
            '0.9s': { x: 0.90, y: 0.50 },
          },
          actual: {
            '0.1s': { x: positions[0] },
            '0.5s': { x: positions[1] },
            '0.9s': { x: positions[2] },
          },
          tolerance: TOLERANCE,
          positionChanged: positions[2] !== positions[0],
          note: 'X/Y keyframe expression reaches the compositor via overlay=x=expr:y=expr',
        }, null, 2));
      } catch { /* best-effort */ }

      console.log('[kf-prod] ===== PRODUCTION KEYFRAME RENDER E2E — PASS =====');
    },
    300_000, // 5 min timeout — production render takes time
  );
});

// Import needed for evidence writing
import { execFileSync } from 'child_process';
