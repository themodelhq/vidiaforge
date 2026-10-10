// VidiaForge — FFmpegMediaProcessor
// Uses child_process.execFile to spawn `ffprobe` and `ffmpeg` (NEVER shell:true).
// Feature-detects binaries on first call and throws MediaProcessorUnavailableError
// if not found — the worker / API can then surface a clear message.

import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, writeFile, readFile, unlink, mkdir } from 'fs/promises';
import { createReadStream } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import type {
  MediaProcessor,
  MediaMetadata,
  GenerateThumbnailInput,
  GenerateWaveformInput,
  GenerateProxyInput,
  ExtractAudioInput,
  GenerateResult,
  WaveformResult,
} from './types';
import { MediaProcessorUnavailableError } from './types';
import { getStorage } from '../storage';

const execFileP = promisify(execFile);

const MAX_BUFFER = 64 * 1024 * 1024; // 64 MB stdout cap (waveforms)

// V9.1 BLOCKER 2: Use the shared MediaBinaryResolver as the SINGLE SOURCE OF TRUTH.
// The old `which()` function used `execFile('command', ...)` which is a shell
// builtin and fails via execFile without shell:true. Now all binary discovery
// goes through binary-resolver.ts which handles: env vars → npm packages →
// system PATH via `which` binary → container default paths.
import { resolveFfmpeg, resolveFfprobe } from './binary-resolver';

let ffmpegPathCache: string | null = null;
let ffprobePathCache: string | null = null;

async function ensureFfmpeg(): Promise<string> {
  if (ffmpegPathCache) return ffmpegPathCache;
  const resolved = await resolveFfmpeg();
  ffmpegPathCache = resolved.path;
  return ffmpegPathCache;
}

async function ensureFfprobe(): Promise<string> {
  if (ffprobePathCache) return ffprobePathCache;
  const resolved = await resolveFfprobe();
  ffprobePathCache = resolved.path;
  return ffprobePathCache;
}

async function tmpFile(ext: string): Promise<{ dir: string; full: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'vf-media-'));
  return { dir, full: path.join(dir, `${randomUUID()}${ext}`) };
}

function parseFps(rateExpr: string | undefined): number | undefined {
  if (!rateExpr) return undefined;
  if (rateExpr === '0/0') return undefined;
  if (rateExpr.includes('/')) {
    const [n, d] = rateExpr.split('/').map(Number);
    if (d && isFinite(n)) return n / d;
  }
  const n = Number(rateExpr);
  return isFinite(n) ? n : undefined;
}

export class FFmpegMediaProcessor implements MediaProcessor {
  readonly name = 'ffmpeg';

  async probe(filePath: string): Promise<MediaMetadata> {
    const ffprobe = await ensureFfprobe();
    const { stdout } = await execFileP(
      ffprobe,
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { maxBuffer: MAX_BUFFER }
    );
    let parsed: any;
    try {
      parsed = JSON.parse(stdout);
    } catch (err) {
      throw new Error(`ffprobe returned non-JSON output: ${err instanceof Error ? err.message : String(err)}`);
    }
    const fmt = parsed.format || {};
    const streams: any[] = Array.isArray(parsed.streams) ? parsed.streams : [];
    const v = streams.find((s) => s.codec_type === 'video');
    const a = streams.find((s) => s.codec_type === 'audio');
    const duration = parseFloat(fmt.duration) || (v?.duration ? parseFloat(v.duration) : 0) || 0;
    const fileSize = parseInt(fmt.size || '0', 10) || 0;
    const mimeType = v ? guessVideoMime(v.codec_name, filePath) : a ? guessAudioMime(a.codec_name, filePath) : 'application/octet-stream';

    return {
      duration,
      width: v ? parseInt(v.width || '0', 10) || undefined : undefined,
      height: v ? parseInt(v.height || '0', 10) || undefined : undefined,
      fps: v ? parseFps(v.avg_frame_rate || v.r_frame_rate) : undefined,
      codec: v?.codec_name || a?.codec_name,
      pixelFormat: v?.pix_fmt,
      audioChannels: a ? parseInt(a.channels || '0', 10) || undefined : undefined,
      audioSampleRate: a ? parseInt(a.sample_rate || '0', 10) || undefined : undefined,
      videoBitrate: v?.bit_rate ? parseInt(v.bit_rate, 10) : fmt.bit_rate ? parseInt(fmt.bit_rate, 10) : undefined,
      audioBitrate: a?.bit_rate ? parseInt(a.bit_rate, 10) : undefined,
      mimeType,
      fileSize,
    };
  }

  async generateThumbnail(input: GenerateThumbnailInput): Promise<GenerateResult> {
    const ffmpeg = await ensureFfmpeg();
    const atTime = Math.max(0, input.atTime ?? 1);
    const width = Math.max(64, input.width ?? 640);
    const { dir, full } = await tmpFile('.jpg');
    try {
      // -ss before -i is fast seek; -vframes 1 grabs a single frame.
      await execFileP(
        ffmpeg,
        [
          '-y', '-ss', String(atTime), '-i', input.inputPath,
          '-vframes', '1',
          '-vf', `scale=${width}:-1`,
          '-q:v', '3',
          full,
        ],
        { maxBuffer: MAX_BUFFER }
      );
      const buf = await readFile(full);
      const storage = getStorage();
      await storage.putObject({
        key: input.outputKey,
        body: buf,
        contentType: 'image/jpeg',
      });
      const url = await storage.createDownloadUrl({ key: input.outputKey });
      return { path: input.outputKey, url };
    } finally {
      await safeUnlink(full).catch(() => {});
      await safeRmdir(dir).catch(() => {});
    }
  }

  async generateWaveform(input: GenerateWaveformInput): Promise<WaveformResult> {
    const ffmpeg = await ensureFfmpeg();
    const peaks = Math.max(16, Math.min(2048, input.peaks ?? 1000));
    // Decode to mono 8kHz f32le PCM, capture raw bytes via stdout pipe.
    const { stdout } = await execFileP(
      ffmpeg,
      [
        '-i', input.inputPath,
        '-ac', '1', '-ar', '8000',
        '-f', 'f32le',
        'pipe:1',
      ],
      { maxBuffer: 256 * 1024 * 1024, encoding: 'buffer' }
    );
    const samples = new Float32Array(stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.byteLength) as ArrayBuffer);
    if (samples.length === 0) {
      throw new Error('Waveform generation produced no samples — is the source silent?');
    }
    const bucketSize = Math.max(1, Math.floor(samples.length / peaks));
    const result: number[] = [];
    for (let i = 0; i < peaks; i++) {
      const start = i * bucketSize;
      const end = Math.min(start + bucketSize, samples.length);
      let max = 0;
      for (let j = start; j < end; j++) {
        const a = Math.abs(samples[j]);
        if (a > max) max = a;
      }
      result.push(Number(max.toFixed(4)));
    }
    const storage = getStorage();
    const json = JSON.stringify({ peaks: result, sampleRate: 8000, channels: 1 });
    await storage.putObject({
      key: input.outputKey,
      body: Buffer.from(json, 'utf-8'),
      contentType: 'application/json',
    });
    const url = await storage.createDownloadUrl({ key: input.outputKey });
    return { path: input.outputKey, url, peaks: result };
  }

  async generateProxy(input: GenerateProxyInput): Promise<GenerateResult> {
    const ffmpeg = await ensureFfmpeg();
    const maxH = Math.max(144, input.maxHeight ?? 720);
    const { dir, full } = await tmpFile('.mp4');
    try {
      await execFileP(
        ffmpeg,
        [
          '-y', '-i', input.inputPath,
          '-vf', `scale=-2:${maxH}`,
          '-c:v', 'libx264', '-crf', '23', '-preset', 'fast',
          '-c:a', 'aac', '-b:a', '128k',
          '-movflags', '+faststart',
          full,
        ],
        { maxBuffer: MAX_BUFFER }
      );
      // V10.1 §30-34: Stream large proxy output — NO readFile/buffering
      const storage = getStorage();
      const stream = createReadStream(full);
      await storage.uploadStream(input.outputKey, stream, { contentType: 'video/mp4' });
      const url = await storage.createDownloadUrl({ key: input.outputKey });
      return { path: input.outputKey, url };
    } finally {
      await safeUnlink(full).catch(() => {});
      await safeRmdir(dir).catch(() => {});
    }
  }

  async extractAudio(input: ExtractAudioInput): Promise<GenerateResult> {
    const ffmpeg = await ensureFfmpeg();
    const { dir, full } = await tmpFile('.wav');
    try {
      await execFileP(
        ffmpeg,
        [
          '-y', '-i', input.inputPath,
          '-vn',
          '-acodec', 'pcm_s16le',
          '-ar', '44100',
          '-ac', '2',
          full,
        ],
        { maxBuffer: MAX_BUFFER }
      );
      // V10.1 §30-34: Stream large audio output — NO readFile/buffering
      const storage = getStorage();
      const stream = createReadStream(full);
      await storage.uploadStream(input.outputKey, stream, { contentType: 'audio/wav' });
      const url = await storage.createDownloadUrl({ key: input.outputKey });
      return { path: input.outputKey, url };
    } finally {
      await safeUnlink(full).catch(() => {});
      await safeRmdir(dir).catch(() => {});
    }
  }
}

function guessVideoMime(codec: string | undefined, pathStr: string): string {
  const ext = path.extname(pathStr).toLowerCase();
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mov') return 'video/quicktime';
  if (codec === 'h264') return 'video/mp4';
  if (codec === 'vp9' || codec === 'vp8') return 'video/webm';
  return 'video/mp4';
}

function guessAudioMime(codec: string | undefined, pathStr: string): string {
  const ext = path.extname(pathStr).toLowerCase();
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.m4a' || ext === '.aac') return 'audio/aac';
  if (ext === '.ogg') return 'audio/ogg';
  if (codec === 'mp3') return 'audio/mpeg';
  if (codec === 'aac') return 'audio/aac';
  return 'audio/mpeg';
}

async function safeUnlink(p: string): Promise<void> {
  try { await unlink(p); } catch { /* ignore */ }
}
async function safeRmdir(p: string): Promise<void> {
  try { await (await import('fs/promises')).rm(p, { recursive: true, force: true }); } catch { /* ignore */ }
}

// Suppress unused-import lint (mkdir used by callers that want to ensure dirs)
void mkdir;
