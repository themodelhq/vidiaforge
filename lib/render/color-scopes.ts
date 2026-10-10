// VidiaForge v19.1 — Color Scopes
//
// V19.1 §24: Real video scopes that operate on actual video frame pixels:
//   - Waveform (luminance parade)
//   - RGB Parade (separate R/G/B waveforms)
//   - Vectorscope (chrominance plot)
//   - Histogram (luminance distribution)
//
// V19.1 §24 NOTE: These are NOT audio waveforms (which are amplitude-over-time).
// Video scopes operate on pixel data from video frames.
//
// Implementation:
//   - Use FFmpeg to extract a frame from a video asset as a PNG
//   - Parse the PNG into RGB pixel data
//   - Compute the scope data from the pixels
//   - Return as a normalized array for the UI to render (WebGL/Canvas)
//
// V19.1 §53: Deterministic — same input frame always produces the same scope data.

import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { inflateSync } from 'zlib';
import path from 'path';
import { getStorage } from '../storage';

const execFileP = promisify(execFile);

export interface WaveformScope {
  /** 256 buckets, each containing the count of pixels at that luminance. */
  buckets: number[];
  /** Max bucket count (for normalization in the UI). */
  maxCount: number;
  /** Total pixels analyzed. */
  totalPixels: number;
}

export interface RgbParadeScope {
  red: WaveformScope;
  green: WaveformScope;
  blue: WaveformScope;
}

export interface VectorscopeData {
  /** Polar coordinates of chrominance pixels. Length = N (sampled). */
  points: Array<{ angle: number; magnitude: number }>;
  /** Bins (e.g. 64x64) containing counts for the UI to render as a heatmap. */
  bins: number[][];
  /** Max bin count (for normalization). */
  maxBinCount: number;
}

export interface HistogramScope {
  /** 256 buckets for each channel. */
  red: number[];
  green: number[];
  blue: number[];
  luminance: number[];
  /** Max count across all channels (for normalization). */
  maxCount: number;
}

export interface ColorScopeResult {
  waveform: WaveformScope;
  rgbParade: RgbParadeScope;
  vectorscope: VectorscopeData;
  histogram: HistogramScope;
  /** Source frame dimensions. */
  width: number;
  height: number;
}

/**
 * V19.1 §24: Extract a frame from a video asset + compute color scopes.
 *
 * @param storageKey The video's storage key
 * @param time Time in seconds to extract the frame at
 * @returns Color scope data for the extracted frame
 */
export async function computeColorScopes(
  storageKey: string,
  time: number = 0,
): Promise<ColorScopeResult> {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'vf-scope-'));
  const framePath = path.join(tempDir, 'frame.png');

  try {
    // V19.1 §24: Download the video to a temp file (if not local)
    const { resolveFfmpeg } = await import('../media/binary-resolver');
    const ffmpegPath = (await resolveFfmpeg()).path;

    // V19.1 §24: If storageKey points to a local file (local storage provider),
    // we can read it directly. Otherwise download to tempDir first.
    const storage = getStorage();
    const isLocal = storage.name === 'local';

    let inputPath: string;
    if (isLocal) {
      // For local storage, the storageKey is relative to UPLOAD_DIR
      const uploadDir = process.env.UPLOAD_DIR || './uploads';
      inputPath = path.join(uploadDir, storageKey);
    } else {
      // Download to temp
      const localVideoPath = path.join(tempDir, 'input.mp4');
      const stream = await storage.getObjectStream(storageKey);
      const reader = stream.getReader();
      const { writeFileSync, openSync, writeSync, closeSync } = await import('fs');
      const fd = openSync(localVideoPath, 'w');
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) writeSync(fd, Buffer.from(value));
      }
      closeSync(fd);
      inputPath = localVideoPath;
    }

    // V19.1 §24: Extract a single frame as PNG (lossless, full color)
    await execFileP(ffmpegPath, [
      '-y',
      '-ss', String(Math.max(0, time)),
      '-i', inputPath,
      '-frames:v', '1',
      '-f', 'image2',
      '-vcodec', 'png',
      framePath,
    ], { timeout: 30_000 });

    // V19.1 §24: Read the PNG + decode into RGB pixel data.
    // We use a minimal PNG decoder (PNG is a well-defined format).
    const pngBuffer = readFileSync(framePath);
    const pixels = decodePng(pngBuffer);

    return computeScopesFromPixels(pixels);
  } finally {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* */ }
  }
}

/**
 * V19.1 §24: Compute all 4 scopes from raw RGB pixel data.
 * Pure function — deterministic + testable.
 */
export function computeScopesFromPixels(pixels: {
  data: Uint8Array;  // RGB or RGBA byte array
  width: number;
  height: number;
  channels: 3 | 4;
}): ColorScopeResult {
  const { data, width, height, channels } = pixels;
  const totalPixels = width * height;

  // V19.1 §24: Waveform — luminance buckets (0..255 → 256 buckets)
  const waveBuckets = new Array(256).fill(0);
  const redBuckets = new Array(256).fill(0);
  const greenBuckets = new Array(256).fill(0);
  const blueBuckets = new Array(256).fill(0);
  const luminanceBuckets = new Array(256).fill(0);

  // Vectorscope: 64x64 bins in polar coords
  const vectorBins = Array.from({ length: 64 }, () => new Array(64).fill(0));

  for (let i = 0; i < totalPixels; i++) {
    const offset = i * channels;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];

    // V19.1 §24: Luminance (Rec. 601): Y = 0.299R + 0.587G + 0.114B
    const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    waveBuckets[y]++;
    luminanceBuckets[y]++;

    redBuckets[r]++;
    greenBuckets[g]++;
    blueBuckets[b]++;

    // V19.1 §24: Vectorscope — chrominance in YUV space
    // U = -0.169R - 0.331G + 0.500B + 128
    // V =  0.500R - 0.419G - 0.081B + 128
    const u = -0.169 * r - 0.331 * g + 0.500 * b + 128;
    const v = 0.500 * r - 0.419 * g - 0.081 * b + 128;
    // Convert to polar: angle in radians, magnitude 0..180
    const dx = u - 128;
    const dy = v - 128;
    const magnitude = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);
    // Bin the angle (0..63) + magnitude (0..63, max ~180)
    const angleBin = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 64) % 64;
    const magBin = Math.min(63, Math.floor(magnitude / 3));
    vectorBins[angleBin][magBin]++;
  }

  const waveMax = Math.max(...waveBuckets);
  const redMax = Math.max(...redBuckets);
  const greenMax = Math.max(...greenBuckets);
  const blueMax = Math.max(...blueBuckets);
  const lumMax = Math.max(...luminanceBuckets);
  const vectorMax = Math.max(...vectorBins.flat());

  return {
    waveform: {
      buckets: waveBuckets,
      maxCount: waveMax,
      totalPixels,
    },
    rgbParade: {
      red: { buckets: redBuckets, maxCount: redMax, totalPixels },
      green: { buckets: greenBuckets, maxCount: greenMax, totalPixels },
      blue: { buckets: blueBuckets, maxCount: blueMax, totalPixels },
    },
    vectorscope: {
      points: [],
      bins: vectorBins,
      maxBinCount: vectorMax,
    },
    histogram: {
      red: redBuckets,
      green: greenBuckets,
      blue: blueBuckets,
      luminance: luminanceBuckets,
      maxCount: Math.max(redMax, greenMax, blueMax, lumMax),
    },
    width,
    height,
  };
}

/**
 * V19.1 §24: Minimal PNG decoder.
 *
 * PNG format:
 *   - 8-byte magic header
 *   - IHDR chunk (13 bytes: width, height, bit depth, color type, etc.)
 *   - IDAT chunk(s) (zlib-compressed pixel data)
 *   - IEND chunk
 *
 * We use Node's built-in zlib to decompress + parse the IHDR for dimensions.
 * Supports color types 2 (RGB) and 6 (RGBA) with 8-bit depth.
 */
function decodePng(buffer: Buffer): { data: Uint8Array; width: number; height: number; channels: 3 | 4 } {
  // Verify PNG magic
  if (buffer.length < 8 ||
      buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4E || buffer[3] !== 0x47) {
    throw new Error('Invalid PNG: missing magic header');
  }

  // Parse IHDR (starts at offset 8)
  // IHDR length is 13 bytes, type is "IHDR" (4 bytes), then 13 bytes of data
  const ihdrLength = buffer.readUInt32BE(8);
  if (ihdrLength !== 13) throw new Error('Invalid PNG: IHDR length != 13');
  const ihdrType = buffer.toString('ascii', 12, 16);
  if (ihdrType !== 'IHDR') throw new Error('Invalid PNG: first chunk not IHDR');

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colorType = buffer[25];

  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth: ${bitDepth} (only 8 supported)`);
  if (colorType !== 2 && colorType !== 6) {
    throw new Error(`Unsupported PNG color type: ${colorType} (only RGB=2 and RGBA=6 supported)`);
  }
  const channels: 3 | 4 = colorType === 6 ? 4 : 3;

  // Collect all IDAT chunks
  let offset = 8 + 4 + 4 + 4 + ihdrLength + 4; // skip IHDR + CRC
  const idatChunks: Buffer[] = [];
  while (offset < buffer.length - 8) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') {
      idatChunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    } else if (type === 'IEND') {
      break;
    }
    offset += 8 + length + 4; // length field + type + data + CRC
  }

  // Decompress all IDAT data with zlib
  const compressed = Buffer.concat(idatChunks);
  const decompressed = inflateSync(compressed);

  // V19.1 §24: PNG uses filter bytes at the start of each row.
  // We need to un-apply the filter to get raw pixel data.
  // For simplicity, we support filter type 0 (None) + 1 (Sub) + 2 (Up) + 3 (Average) + 4 (Paeth.
  const rowSize = width * channels;
  const output = Buffer.alloc(rowSize * height);
  let srcOffset = 0;
  let prevRow: Buffer | null = null;

  for (let y = 0; y < height; y++) {
    const filterType = decompressed[srcOffset++];
    const rowStart = srcOffset;
    const rowEnd = srcOffset + rowSize;
    const row = Buffer.from(decompressed.subarray(rowStart, rowEnd));

    // Apply un-filter
    switch (filterType) {
      case 0: // None
        break;
      case 1: // Sub
        for (let i = channels; i < rowSize; i++) {
          row[i] = (row[i] + row[i - channels]) & 0xFF;
        }
        break;
      case 2: // Up
        if (prevRow) {
          for (let i = 0; i < rowSize; i++) {
            row[i] = (row[i] + prevRow[i]) & 0xFF;
          }
        }
        break;
      case 3: // Average
        for (let i = 0; i < rowSize; i++) {
          const left = i >= channels ? row[i - channels] : 0;
          const up = prevRow ? prevRow[i] : 0;
          row[i] = (row[i] + Math.floor((left + up) / 2)) & 0xFF;
        }
        break;
      case 4: // Paeth
        for (let i = 0; i < rowSize; i++) {
          const left = i >= channels ? row[i - channels] : 0;
          const up = prevRow ? prevRow[i] : 0;
          const upLeft = prevRow && i >= channels ? prevRow[i - channels] : 0;
          const predictor = paethPredictor(left, up, upLeft);
          row[i] = (row[i] + predictor) & 0xFF;
        }
        break;
      default:
        throw new Error(`Unsupported PNG filter type: ${filterType}`);
    }

    row.copy(output, y * rowSize);
    prevRow = row;
    srcOffset = rowEnd;
  }

  return { data: new Uint8Array(output), width, height, channels };
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
