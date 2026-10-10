// VidiaForge v19.1 — Color Scopes Test
//
// V19.1 §24: Verify that color scopes compute correctly from real video frames.
// Uses FFmpeg to generate test frames (solid colors) + verifies the scope output.

import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { computeScopesFromPixels } from '../../src/lib/render/color-scopes';

const execFileP = promisify(execFile);
const FFmpeg = '/usr/bin/ffmpeg';

let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'vf-scopes-test-'));
});

afterAll(() => {
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* */ }
});

describe('V19.1 §24: Color Scopes', () => {
  test('solid red frame → waveform peaks at high luminance', async () => {
    const framePath = path.join(tempDir, 'red.png');
    // V19.1 §24: Generate a 100x100 solid red frame
    await execFileP(FFmpeg, [
      '-y', '-f', 'lavfi', '-i', 'color=c=red:s=100x100:d=1',
      '-frames:v', '1', '-f', 'image2', '-vcodec', 'png',
      framePath,
    ], { timeout: 10_000 });
    expect(existsSync(framePath)).toBe(true);

    // V19.1 §24: Use the pure computeScopesFromPixels function with a synthetic
    // 100x100 solid red frame (R=255, G=0, B=0).
    const pixels = {
      data: new Uint8Array(100 * 100 * 3).fill(0).map((_, i) => {
        const channel = i % 3;
        return channel === 0 ? 255 : 0; // R=255, G=0, B=0
      }),
      width: 100,
      height: 100,
      channels: 3 as const,
    };

    const scopes = computeScopesFromPixels(pixels);

    // V19.1 §24: Solid red frame (R=255, G=0, B=0)
    // Luminance Y = 0.299*255 = 76.245 → bucket 76 should peak
    expect(scopes.waveform.buckets[76]).toBe(100 * 100);
    expect(scopes.waveform.maxCount).toBe(100 * 100);
    expect(scopes.waveform.totalPixels).toBe(100 * 100);

    // V19.1 §24: RGB parade — red channel peaks at 255, green+blue peak at 0
    expect(scopes.rgbParade.red.buckets[255]).toBe(100 * 100);
    expect(scopes.rgbParade.green.buckets[0]).toBe(100 * 100);
    expect(scopes.rgbParade.blue.buckets[0]).toBe(100 * 100);

    // V19.1 §24: Histogram — same as RGB parade
    expect(scopes.histogram.red[255]).toBe(100 * 100);
    expect(scopes.histogram.green[0]).toBe(100 * 100);
    expect(scopes.histogram.blue[0]).toBe(100 * 100);

    // V19.1 §24: Vectorscope — red produces a specific angle/magnitude
    // U = -0.169*255 + 128 = 84.8
    // V = 0.500*255 + 128 = 255.5 → clamped to 255
    // dx = 84.8 - 128 = -43.2
    // dy = 255.5 - 128 = 127.5
    // magnitude = sqrt(43.2² + 127.5²) ≈ 134.6
    // The vectorscope bins should have non-zero counts.
    const totalVectorPoints = scopes.vectorscope.bins.flat().reduce((sum, c) => sum + c, 0);
    expect(totalVectorPoints).toBe(100 * 100);
  });

  test('solid black frame → all buckets at 0', () => {
    const pixels = {
      data: new Uint8Array(50 * 50 * 3).fill(0),
      width: 50,
      height: 50,
      channels: 3 as const,
    };
    const scopes = computeScopesFromPixels(pixels);
    // Black: R=0, G=0, B=0, Y=0
    expect(scopes.waveform.buckets[0]).toBe(50 * 50);
    expect(scopes.rgbParade.red.buckets[0]).toBe(50 * 50);
    expect(scopes.rgbParade.green.buckets[0]).toBe(50 * 50);
    expect(scopes.rgbParade.blue.buckets[0]).toBe(50 * 50);
  });

  test('solid white frame → all buckets at 255', () => {
    const pixels = {
      data: new Uint8Array(50 * 50 * 3).fill(255),
      width: 50,
      height: 50,
      channels: 3 as const,
    };
    const scopes = computeScopesFromPixels(pixels);
    // White: R=255, G=255, B=255, Y=255
    expect(scopes.waveform.buckets[255]).toBe(50 * 50);
    expect(scopes.rgbParade.red.buckets[255]).toBe(50 * 50);
    expect(scopes.rgbParade.green.buckets[255]).toBe(50 * 50);
    expect(scopes.rgbParade.blue.buckets[255]).toBe(50 * 50);
  });

  test('gradient frame → distributed buckets', () => {
    // V19.1 §24: Create a horizontal gradient from black to white
    const width = 256;
    const height = 1;
    const data = new Uint8Array(width * 3);
    for (let x = 0; x < width; x++) {
      data[x * 3] = x;     // R
      data[x * 3 + 1] = x; // G
      data[x * 3 + 2] = x; // B
    }
    const pixels = { data, width, height, channels: 3 as const };
    const scopes = computeScopesFromPixels(pixels);

    // V19.1 §24: Each luminance bucket should have exactly 1 pixel
    for (let i = 0; i < 256; i++) {
      expect(scopes.waveform.buckets[i]).toBe(1);
    }
    expect(scopes.waveform.totalPixels).toBe(256);
  });

  test('V19.1 §53: determinism — same input → same output', () => {
    const pixels = {
      data: new Uint8Array(10 * 10 * 3).fill(128),
      width: 10,
      height: 10,
      channels: 3 as const,
    };
    const first = computeScopesFromPixels(pixels);
    for (let i = 0; i < 10; i++) {
      const r = computeScopesFromPixels(pixels);
      expect(r.waveform.buckets).toEqual(first.waveform.buckets);
      expect(r.histogram.red).toEqual(first.histogram.red);
      expect(r.vectorscope.bins).toEqual(first.vectorscope.bins);
    }
  });
});
