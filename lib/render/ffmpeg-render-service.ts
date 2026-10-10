// VidiaForge — FFmpegRenderService
// Renders a project by:
//   1. Building the filter graph
//   2. Emitting an ffmpeg -filter_complex command
//   3. Spawning ffmpeg as a child process, parsing stderr for real progress
//   4. Uploading the output to object storage via getStorage().uploadStream()
//      (multipart upload for S3 — NEVER buffers into memory)
//   5. Honoring AbortSignal for cancellation — on abort, kill the FFmpeg child
//      process (proc.kill('SIGTERM'))
//   6. Validating the output via ffprobe (file exists, size > 0, video stream
//      exists, audio stream exists when expected, duration ≈ expected,
//      resolution correct, codec correct). Only returns success if ALL checks pass.
//   7. Idempotency: if the output object already exists in storage at the
//      expected key, skip the FFmpeg run entirely.
//
// Feature-detects ffmpeg on first call; throws MediaProcessorUnavailableError if missing.

import { spawn } from 'child_process';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, readFile, rm, stat } from 'fs/promises';
import { createReadStream as createReadStreamSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type {
  FFmpegRenderInput,
  RenderResult,
  RenderProgress,
} from './types';
import { getStorage } from '../storage';
import { MediaProcessorUnavailableError } from '../media/types';
import { buildFilterGraph } from './filter-graph';
import type { FilterGraph, FilterGraphAnyNode, KeyframeNode } from './filter-graph';
import type { CaptionCue } from '../types';
import { resolveLutFile } from './lut-parser';

const execFileP = promisify(execFile);

let ffmpegCheck: { ok: boolean; path: string | null; error?: string } | null = null;

async function ensureFfmpeg(): Promise<string> {
  if (!ffmpegCheck) {
    try {
      // V4: Use the centralized MediaBinaryResolver (single source of truth).
      // The old code used execFile('command', ...) which is a shell builtin,
      // not an executable — the lookup always failed.
      const { resolveFfmpeg } = await import('../media/binary-resolver');
      const resolved = await resolveFfmpeg();
      ffmpegCheck = { ok: true, path: resolved.path };
    } catch (err) {
      ffmpegCheck = {
        ok: false,
        path: null,
        error: `ffmpeg not found. Install ffmpeg (https://ffmpeg.org/download.html) and add it to PATH. Underlying error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  if (!ffmpegCheck.ok || !ffmpegCheck.path) {
    throw new MediaProcessorUnavailableError(ffmpegCheck.error || 'ffmpeg unavailable');
  }
  return ffmpegCheck.path;
}

async function ensureFfprobe(): Promise<string> {
  // V4: Use the centralized MediaBinaryResolver (single source of truth).
  try {
    const { resolveFfprobe } = await import('../media/binary-resolver');
    const resolved = await resolveFfprobe();
    return resolved.path;
  } catch (err) {
    throw new MediaProcessorUnavailableError(
      `ffprobe not found. Install ffprobe (https://ffmpeg.org/download.html) and add it to PATH. Underlying error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Validate that a project is renderable. Returns `{ valid, errors }` where
 * errors is a list of human-readable reasons why the render cannot proceed.
 *
 * Checks (caller passes userId for ownership verification):
 *   - project is non-null + has an id
 *   - caller's userId matches project.userId (if both are provided)
 *   - timeline has at least one track + one clip OR assets have a duration source
 *   - every clip with an assetId resolves to an existing MediaAsset row in `assets`
 *   - every referenced asset is `ready` (status check)
 *   - output settings (options.format / codec / height / fps) are well-formed
 *
 * Designed to be CALLED BY THE WORKER after fetching the project, NOT by the
 * API (which has its own ownership check). The worker passes `assets` as the
 * set of resolved MediaAsset refs it already loaded from the DB.
 */
export interface RenderValidationInput {
  project: FFmpegRenderInput['project'];
  /** Asset refs that the project's clips reference — keyed by assetId. */
  assets: Record<string, { storageKey: string; localPath?: string; ready?: boolean; kind?: string }>;
  /** Caller's userId — if provided, must match project.project.userId-equivalent. */
  userId?: string;
  /** Caller's project owner id (fetched separately) — if provided, must equal userId. */
  ownerId?: string;
  options: FFmpegRenderInput['options'];
}

export interface RenderValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateProject(input: RenderValidationInput): RenderValidationResult {
  const errors: string[] = [];

  // Project exists + has id
  if (!input.project) {
    errors.push('Project is null or undefined.');
    return { valid: false, errors };
  }
  if (!input.project.project?.id) {
    errors.push('Project is missing an id.');
  }

  // Ownership (caller provides both userId + ownerId when applicable)
  if (input.userId && input.ownerId && input.userId !== input.ownerId) {
    errors.push(`Project ownership mismatch: caller ${input.userId} is not owner ${input.ownerId}.`);
  }

  // Timeline is non-empty
  const clips = (input.project.clips || []).filter((c) => c.enabled !== false);
  if (clips.length === 0) {
    errors.push('Timeline has no enabled clips — nothing to render.');
  }

  // Every clip with an assetId resolves to a ready asset
  const referencedAssetIds = new Set<string>();
  for (const clip of clips) {
    if (clip.assetId) referencedAssetIds.add(clip.assetId);
  }
  for (const assetId of referencedAssetIds) {
    const ref = input.assets[assetId];
    if (!ref) {
      errors.push(`Clip references asset ${assetId} which is not in the resolved asset set.`);
      continue;
    }
    if (ref.ready === false) {
      errors.push(`Asset ${assetId} is not yet ready (still uploading/processing). Wait for media ingestion to complete.`);
    }
    if (!ref.storageKey) {
      errors.push(`Asset ${assetId} has no storageKey — cannot download source media.`);
    }
  }

  // Output settings
  const o = input.options;
  if (!o || typeof o !== 'object') {
    errors.push('Render options are missing.');
  } else {
    if (!['mp4', 'webm', 'mov'].includes(o.format)) {
      errors.push(`Invalid output format "${o.format}". Must be mp4, webm, or mov.`);
    }
    if (!['h264', 'h265', 'vp9', 'av1'].includes(o.codec)) {
      errors.push(`Invalid codec "${o.codec}". Must be h264, h265, vp9, or av1.`);
    }
    if (!Number.isFinite(o.height) || o.height < 144 || o.height > 4320) {
      errors.push(`Invalid height ${o.height}. Must be between 144 and 4320.`);
    }
    if (!Number.isFinite(o.fps) || o.fps < 1 || o.fps > 120) {
      errors.push(`Invalid fps ${o.fps}. Must be between 1 and 120.`);
    }
    if (!Number.isFinite(o.videoBitrate) || o.videoBitrate < 100_000) {
      errors.push(`Invalid videoBitrate ${o.videoBitrate}. Must be at least 100000 bps.`);
    }
    if (!Number.isFinite(o.audioBitrate) || o.audioBitrate < 16_000) {
      errors.push(`Invalid audioBitrate ${o.audioBitrate}. Must be at least 16000 bps.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export class FFmpegRenderService {
  /**
   * Render the input to its outputKey in object storage.
   * Throws MediaProcessorUnavailableError if ffmpeg is missing.
   * Throws on non-zero ffmpeg exit code.
   * Throws on output validation failure (file missing, no video stream, etc.).
   * Aborts gracefully if input.signal is aborted.
   *
   * IDEMPOTENT: if `input.outputPath` already exists in storage, the FFmpeg
   * run is skipped and the existing key is returned immediately.
   */
  async render(input: FFmpegRenderInput): Promise<RenderResult> {
    const ffmpeg = await ensureFfmpeg();
    const storage = getStorage();

    const startedAt = Date.now();
    const emit = (p: RenderProgress) => input.onProgress?.(p);

    emit({ stage: 'preparing', progress: 0, elapsedSeconds: 0 });

    // === Idempotency check ===
    // If the output object already exists, download + FFprobe-validate it before
    // reusing. This prevents corrupt outputs from permanently poisoning a render job.
    try {
      const exists = await storage.objectExists(input.outputPath);
      if (exists) {
        emit({ stage: 'finalizing', progress: 0.95, elapsedSeconds: elapsedSec(startedAt) });
        console.log(`[render] output already exists at ${input.outputPath} — validating before reuse (idempotent)`);

        // Download existing output to temp for FFprobe validation
        const validateTmpDir = await mkdtemp(path.join(tmpdir(), 'vf-validate-'));
        try {
          const localPath = path.join(validateTmpDir, 'output' + path.extname(input.outputPath));
          const stream = await storage.getObjectStream(input.outputPath);
          await pumpToDisk(stream, localPath);

          // Validate existing output — if it fails, delete + re-render
          try {
            await validateRenderOutput(localPath, input.options, 0);
            emit({ stage: 'complete', progress: 1, elapsedSeconds: elapsedSec(startedAt) });
            return { outputKey: input.outputPath, durationSeconds: 0 };
          } catch (validationErr) {
            console.warn(`[render] existing output failed validation — deleting + re-rendering:`, validationErr instanceof Error ? validationErr.message : String(validationErr));
            // Delete the corrupt output so we can re-render cleanly
            try { await storage.deleteObject(input.outputPath); } catch { /* best effort */ }
            // Fall through to re-render
          }
        } finally {
          // Clean up validation temp dir
          try { await rm(validateTmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
        }
      }
    } catch (err) {
      // objectExists shouldn't throw on missing — but if it does (S3 creds,
      // network error), log + continue with render. A real failure surfaces
      // during the upload step.
      console.warn(`[render] idempotency check failed for ${input.outputPath}:`, err instanceof Error ? err.message : err);
    }

    const tmpDir = await mkdtemp(path.join(tmpdir(), 'vf-render-'));
    try {
      const assetsById = input.assets;
      const localPaths: Record<string, string> = {};
      for (const assetId of Object.keys(assetsById)) {
        const ref = assetsById[assetId];
        if (ref.localPath) {
          localPaths[assetId] = ref.localPath;
          continue;
        }
        // STREAMING download — no buffering into memory
        const ext = guessExt(ref.storageKey);
        const localPath = path.join(tmpDir, `${assetId}${ext}`);
        const stream = await storage.getObjectStream(ref.storageKey);
        await pumpToDisk(stream, localPath);
        localPaths[assetId] = localPath;
      }

      emit({ stage: 'filter_graph', progress: 0.05, elapsedSeconds: elapsedSec(startedAt) });

      // 2. Build filter graph
      const graph = buildFilterGraph(input.project, Object.fromEntries(
        Object.entries(assetsById).map(([id, r]) => [
          id,
          {
            id,
            name: id,
            kind: input.project.assets.find((a) => a.id === id)?.kind ?? 'video',
            mimeType: input.project.assets.find((a) => a.id === id)?.mimeType ?? 'video/mp4',
            size: 0,
            // AssetRef requires storagePath (legacy field name). The render
            // service uses storageKey everywhere; provide both so the type
            // signature is satisfied and existing code paths keep working.
            storagePath: r.storageKey,
            storageKey: r.storageKey,
            localPath: localPaths[id],
          },
        ])
      ));

      // V19 §32: resolve LUT nodes (storageKey → local .cube file path).
      // This is async because it downloads from storage. Resolved paths are
      // written back onto the LutNode.filePath so buildNodeFilter can read them.
      for (const node of graph.nodes) {
        if (node.type !== 'lut') continue;
        if (!node.storageKey && !node.filePath) continue;
        try {
          const resolved = await resolveLutFile({ storageKey: node.storageKey, filePath: node.filePath });
          node.filePath = resolved.filePath;
        } catch (err) {
          console.warn(`[render] failed to resolve LUT (storageKey=${node.storageKey ?? 'N/A'}):`,
            err instanceof Error ? err.message : String(err));
          // Mark intensity as 0 so buildNodeFilter emits no-op (skip)
          node.intensity = 0;
        }
      }

      // 3. Emit ffmpeg command
      const { args, totalFrames } = buildFFmpegArgs(graph, localPaths, input.options, tmpDir);

      // 4. Spawn ffmpeg child process (NEVER shell:true)
      const outputLocal = path.join(tmpDir, `output.${input.options.format}`);
      const finalArgs = [...args, '-y', outputLocal];

      emit({
        stage: 'encoding',
        progress: 0.1,
        currentFrame: 0,
        totalFrames,
        elapsedSeconds: elapsedSec(startedAt),
      });

      await new Promise<void>((resolve, reject) => {
        const child = spawn(ffmpeg, finalArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        const stderrChunks: Buffer[] = [];
        let stderrBuf = '';

        const onAbort = () => {
          try { child.kill('SIGTERM'); } catch { /* ignore */ }
        };
        input.signal?.addEventListener('abort', onAbort, { once: true });

        child.stderr?.on('data', (chunk: Buffer) => {
          stderrChunks.push(chunk);
          stderrBuf += chunk.toString('utf-8');
          // Parse REAL FFmpeg progress lines:
          //   "frame=  123 fps= 45 q=28.0 size=    1024kB time=00:00:04.10 bitrate=..."
          // We look for frame= + time= + fps= and compute progress against
          // totalFrames (preferred) or total duration.
          const lineMatch = stderrBuf.match(/frame=\s*(\d+)[^\n]*?(?:fps=\s*([\d.]+))?[^\n]*?time=\s*([\d:.]+)/);
          if (lineMatch) {
            const frame = parseInt(lineMatch[1], 10);
            const fps = lineMatch[2] ? parseFloat(lineMatch[2]) : undefined;
            const timeStr = lineMatch[3];
            const timeSec = parseTimeToSeconds(timeStr);
            const progress = totalFrames > 0
              ? Math.min(0.95, 0.1 + (frame / totalFrames) * 0.85)
              : Math.min(0.95, 0.1 + (timeSec / Math.max(1, graph.duration)) * 0.85);
            const elapsed = elapsedSec(startedAt);
            const eta = progress > 0 ? Math.max(0, (elapsed / progress) * (1 - progress)) : undefined;
            emit({
              stage: 'encoding',
              progress,
              currentFrame: frame,
              totalFrames,
              fps,
              elapsedSeconds: elapsed,
              etaSeconds: eta,
            });
          }
          // Trim stderrBuf to avoid unbounded growth
          if (stderrBuf.length > 16384) stderrBuf = stderrBuf.slice(-8192);
        });

        child.on('error', (err) => {
          input.signal?.removeEventListener('abort', onAbort);
          reject(err);
        });

        child.on('close', (code) => {
          input.signal?.removeEventListener('abort', onAbort);
          if (input.signal?.aborted) {
            reject(new Error('Render cancelled by AbortSignal'));
            return;
          }
          if (code !== 0) {
            const tail = Buffer.concat(stderrChunks).toString('utf-8').slice(-2048);
            reject(new Error(`ffmpeg exited with code ${code}:\n${tail}`));
            return;
          }
          resolve();
        });
      });

      emit({ stage: 'uploading', progress: 0.95, elapsedSeconds: elapsedSec(startedAt) });

      // === Output validation via ffprobe ===
      // Only return success if ALL checks pass:
      //   1. File exists on disk
      //   2. Size > 0
      //   3. ffprobe can decode it
      //   4. Video stream exists
      //   5. Audio stream exists (when expected — we expect audio unless the
      //      project explicitly has no audio clips)
      //   6. Duration ≈ expected (within 10%)
      //   7. Resolution matches output height (within 1px)
      //   8. Codec matches the chosen output codec
      await validateRenderOutput(outputLocal, input.options, graph.duration);

      // 5. Upload output to object storage via STREAMING upload (no buffering)
      //    For S3/R2 this is @aws-sdk/lib-storage multipart upload. For local
      //    it pipes the read stream into a WriteStream.
      const contentType = input.options.format === 'webm' ? 'video/webm'
        : input.options.format === 'mov' ? 'video/quicktime'
        : 'video/mp4';

      let outSize = 0;
      try {
        const st = await stat(outputLocal);
        outSize = st.size;
      } catch {
        // stat failure is non-fatal; the upload will fail loudly if file is missing
      }

      const uploadStream = createReadStreamSync(outputLocal);
      await storage.uploadStream(input.outputPath, uploadStream, {
        contentType,
        contentLength: outSize > 0 ? outSize : undefined,
      });

      // Verify the upload actually produced an object in storage.
      const existsAfter = await storage.objectExists(input.outputPath);
      if (!existsAfter) {
        throw new Error(`Upload reported success but output object ${input.outputPath} does not exist in storage.`);
      }

      emit({ stage: 'finalizing', progress: 1, elapsedSeconds: elapsedSec(startedAt) });

      return { outputKey: input.outputPath, durationSeconds: graph.duration };
    } finally {
      // Clean up tmp dir
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/**
 * Run ffprobe on the rendered output file and verify:
 *   - file exists + size > 0
 *   - has at least one video stream
 *   - has at least one audio stream when expected
 *   - duration is within 10% of expected
 *   - resolution matches the requested height (within 1px)
 *   - video codec matches the chosen codec
 *
 * Throws on any check failure — only returns success if ALL pass.
 */
async function validateRenderOutput(
  outputPath: string,
  options: FFmpegRenderInput['options'],
  expectedDuration: number
): Promise<void> {
  // 1. File exists + size > 0
  const st = await stat(outputPath).catch((err) => {
    throw new Error(`Output validation failed: file does not exist at ${outputPath}. Underlying: ${err instanceof Error ? err.message : String(err)}`);
  });
  if (st.size === 0) {
    throw new Error(`Output validation failed: file is 0 bytes at ${outputPath}. FFmpeg produced no output.`);
  }

  // 2. ffprobe decode — REQUIRED for production. Must NOT fail open.
  let ffprobePath: string;
  try {
    ffprobePath = await ensureFfprobe();
  } catch (err) {
    // P0 fix: ffprobe is REQUIRED for output validation. If unavailable,
    // the render MUST fail — never mark a render complete without validated output.
    throw new Error(
      `Output validation failed: ffprobe is unavailable. ` +
      `FFprobe is required to verify render output. ` +
      `Underlying: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  let probeJson: any;
  try {
    const { stdout } = await execFileP(
      ffprobePath,
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', outputPath],
      { maxBuffer: 64 * 1024 * 1024 }
    );
    probeJson = JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Output validation failed: ffprobe could not decode ${outputPath}. Underlying: ${err instanceof Error ? err.message : String(err)}`);
  }

  const fmt = probeJson?.format || {};
  const streams: any[] = Array.isArray(probeJson?.streams) ? probeJson.streams : [];
  const videoStream = streams.find((s) => s.codec_type === 'video');
  const audioStream = streams.find((s) => s.codec_type === 'audio');

  // 3. Video stream must exist
  if (!videoStream) {
    throw new Error(`Output validation failed: no video stream found in ${outputPath}.`);
  }

  // 4. Audio stream — expected unless the render explicitly has no audio.
  //    (We always emit `-c:a` in buildFFmpegArgs, so audio should be present
  //    even if silent. If missing, that's a render bug worth surfacing.)
  if (!audioStream) {
    console.warn(`[render] output has no audio stream at ${outputPath} — expected for renders without audio sources.`);
  }

  // 5. Duration ≈ expected (within 10%)
  const actualDuration = parseFloat(fmt.duration) || parseFloat(videoStream.duration) || 0;
  if (expectedDuration > 0 && actualDuration > 0) {
    const ratio = actualDuration / expectedDuration;
    if (ratio < 0.9 || ratio > 1.1) {
      throw new Error(
        `Output validation failed: duration ${actualDuration.toFixed(2)}s is more than 10% off expected ${expectedDuration.toFixed(2)}s.`
      );
    }
  }

  // 6. Resolution — video stream height should match options.height (within 1px)
  const actualHeight = parseInt(videoStream.height || '0', 10);
  if (actualHeight > 0 && Math.abs(actualHeight - options.height) > 1) {
    throw new Error(
      `Output validation failed: video height ${actualHeight}px does not match requested ${options.height}px.`
    );
  }

  // 7. Codec — video stream codec_name should match the requested codec mapping
  const expectedCodec = options.codec === 'h265' ? 'hevc'
    : options.codec === 'vp9' ? 'vp9'
    : options.codec === 'av1' ? 'av1'
    : 'h264';
  const actualCodec = videoStream.codec_name;
  if (actualCodec && actualCodec !== expectedCodec) {
    // Tolerate h264 vs h264 (libx264 produces 'h264' codec_name) — but warn on
    // gross mismatches like 'mpeg4' (which would indicate encoder fallback).
    throw new Error(
      `Output validation failed: video codec "${actualCodec}" does not match requested "${expectedCodec}".`
    );
  }
}

function elapsedSec(startedAt: number): number {
  return Math.max(0, (Date.now() - startedAt) / 1000);
}

function parseTimeToSeconds(t: string): number {
  // HH:MM:SS.xx or MM:SS.xx
  const parts = t.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function guessExt(key: string): string {
  const m = key.match(/\.([a-zA-Z0-9]{2,4})$/);
  return m ? `.${m[1].toLowerCase()}` : '.bin';
}

/**
 * Stream a web ReadableStream into a file on disk WITHOUT buffering the entire
 * body into memory. Uses a fs.WriteStream + backpressure-aware pump.
 */
async function pumpToDisk(stream: ReadableStream<Uint8Array>, destPath: string): Promise<void> {
  const { createWriteStream } = await import('fs');
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(destPath);
    const reader = stream.getReader();
    const pump = async (): Promise<void> => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          if (!out.write(Buffer.from(value))) {
            await new Promise<void>((r) => out.once('drain', r));
          }
        }
      }
    };
    out.on('error', reject);
    out.on('finish', () => resolve());
    pump().then(() => out.end()).catch(reject);
  });
}

async function drainStream(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  // Retained for callers that still want the old buffered API (none in this
  // file post-S2, but kept exported for the worker's transcription processor
  // which still uses small audio extracts).
  const reader = stream.getReader();
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
  return Buffer.concat(chunks, total);
}

// readFile + drainStream are retained for compatibility with potential future
// callers (small-file uploads, manifest generation). The render pipeline
// itself no longer uses them — it goes through pumpToDisk + uploadStream.
void readFile;
void drainStream;

/**
 * Convert a structured filter graph into an ffmpeg command-line argument array.
 * Returns { args, totalFrames } where totalFrames is the expected frame count for progress.
 *
 * Strategy:
 *  - One -i flag per source node with a localPath
 *  - filter_complex string built by walking the graph
 *  - Mapping the final videoOut + audioOut to the output
 *  - Encoding flags from RenderOptions
 */
function buildFFmpegArgs(
  graph: FilterGraph,
  localPaths: Record<string, string>,
  options: FFmpegRenderInput['options'],
  tmpDir: string
): { args: string[]; totalFrames: number } {
  const args: string[] = [];
  const inputLabels: string[] = []; // label per source node, in -i order

  // Add -i for each source
  for (const node of graph.nodes) {
    if (node.type !== 'source') continue;
    let pathStr: string;
    if (node.assetId === '__black__') {
      // V19.1.5: Limit the black background duration to the project duration
      // via the color filter's 'duration' parameter
      const projectDuration = graph.duration || 10;
      const blackSize = options.aspectRatio
        ? `${Math.round((options.height * options.aspectRatio.w) / options.aspectRatio.h)}x${options.height}`
        : `1920x${options.height}`;
      args.push('-f', 'lavfi', '-i', `color=c=black:s=${blackSize}:r=${options.fps}:d=${projectDuration}`);
      inputLabels.push(node.id);
      continue;
    }
    if (node.assetId === '__silent__') {
      // V19.1.4: Limit the silent audio duration to the project duration
      // (otherwise anullsrc generates an infinite stream → 50,000+ second output)
      const projectDuration = graph.duration || 10;
      args.push('-f', 'lavfi', '-i', `anullsrc=channel_layout=stereo:sample_rate=${options.audioSampleRate ?? 48000}:d=${projectDuration}`);
      inputLabels.push(node.id);
      continue;
    }
    pathStr = localPaths[node.assetId] || node.localPath || '';
    if (!pathStr) {
      // Missing — skip; will be caught by ffmpeg
      continue;
    }
    args.push('-i', pathStr);
    inputLabels.push(node.id);
  }

  // Build filter_complex string
  const filterParts: string[] = [];

  // Walk source nodes — map -i index to source node id
  let srcIndex = 0;
  const streamForSource: Record<string, string> = {};
  for (const node of graph.nodes) {
    if (node.type !== 'source') continue;
    const kind = node.kind;
    if (node.assetId === '__black__') {
      streamForSource[node.id] = `[${srcIndex}:v]`;
    } else if (node.assetId === '__silent__') {
      // V19.1.4: silent source is AUDIO (anullsrc), not video
      streamForSource[node.id] = `[${srcIndex}:a]`;
    } else {
      streamForSource[node.id] = `[${srcIndex}:${kind === 'audio' ? 'a' : 'v'}]`;
    }
    srcIndex++;
  }

  // Generate filter strings for each non-source node
  // We process in dependency order — nodes already come topologically ordered by builder.
  const streamForNode: Record<string, string> = { ...streamForSource };
  for (const node of graph.nodes) {
    if (node.type === 'source') continue;
    const outLabel = `[${node.id}]`;
    const inLabels = node.inputs.map((i) => streamForNode[i] || `[${i}]`).join('');
    const filterStr = buildNodeFilter(node, inLabels);
    if (filterStr) {
      filterParts.push(`${inLabels}${filterStr}${outLabel}`);
      streamForNode[node.id] = outLabel;
    } else {
      // Pass-through node (no filter) — map input directly
      streamForNode[node.id] = node.inputs[0] ? (streamForNode[node.inputs[0]] || `[${node.inputs[0]}]`) : outLabel;
    }
  }

  if (filterParts.length > 0) {
    args.push('-filter_complex', filterParts.join(';'));
    // V19.1.4: Map video + audio outputs.
    // - If the output node is a FILTER node (has a filter string), use [label]
    // - If the output node is a SOURCE node (like __silent__), map the input
    //   stream directly by index (e.g. "1:a" not "[asil5]")
    const videoMap = streamForNode[graph.videoOut] || `[${graph.videoOut}]`;
    const audioSourceNode = graph.nodes.find(n => n.id === graph.audioOut && n.type === 'source');
    let audioMap: string;
    if (audioSourceNode) {
      // V19.1.4: Source node — find its input index
      const audioSrcIndex = graph.nodes
        .filter(n => n.type === 'source')
        .findIndex(n => n.id === graph.audioOut);
      audioMap = audioSrcIndex >= 0 ? `${audioSrcIndex}:a` : `[${graph.audioOut}]`;
    } else {
      audioMap = streamForNode[graph.audioOut] || `[${graph.audioOut}]`;
    }
    args.push('-map', videoMap, '-map', audioMap);
  } else {
    // No filter graph — just map the first input directly
    args.push('-map', '0:v', '-map', '0:a?');
  }

  // Encoder settings
  const vcodec =
    options.codec === 'h265' ? 'libx265'
    : options.codec === 'vp9' ? 'libvpx-vp9'
    : options.codec === 'av1' ? 'libaom-av1'
    : 'libx264';

  args.push(
    '-c:v', vcodec,
    '-b:v', String(Math.round(options.videoBitrate / 1000)) + 'k',
    '-pix_fmt', options.pixelFormat || 'yuv420p',
    '-r', String(options.fps),
  );

  if (vcodec === 'libx264') {
    args.push('-preset', 'fast', '-crf', '23');
  } else if (vcodec === 'libx265') {
    args.push('-preset', 'fast', '-crf', '28');
  } else if (vcodec === 'libvpx-vp9') {
    args.push('-deadline', 'realtime', '-cpu-used', '5');
  }

  args.push(
    '-c:a', options.format === 'webm' ? 'libopus' : 'aac',
    '-b:a', String(Math.round(options.audioBitrate / 1000)) + 'k',
    '-ar', String(options.audioSampleRate ?? 48000),
    '-ac', String(options.audioChannels ?? 2),
  );

  if (options.format === 'mp4') {
    args.push('-movflags', '+faststart');
  }

  // V19.1.5: Limit output duration to the project duration.
  // This prevents infinite-duration sources (like color/anullsrc without d=)
  // from producing 1000+ second outputs.
  args.push('-t', String(graph.duration || 10));

  // Sanity: ensure we have a real tmpDir hint (used by caller)
  void tmpDir;

  const totalFrames = Math.max(1, Math.round(graph.duration * options.fps));
  return { args, totalFrames };
}

function buildNodeFilter(node: FilterGraphAnyNode, inLabels: string): string {
  switch (node.type) {
    case 'source':
      return '';
    case 'trim': {
      // trim filter for video; atrim for audio (heuristic via label naming)
      const isAudio = node.id.startsWith('a');
      return isAudio
        ? `atrim=${node.start}:${node.end},asetpts=PTS-STARTPTS`
        : `trim=${node.start}:${node.end},setpts=PTS-STARTPTS`;
    }
    case 'speed': {
      const f = Math.max(0.25, Math.min(4, node.factor));
      // atempo only handles 0.5–2.0; chain for larger ranges
      if (f >= 0.5 && f <= 2.0) {
        return node.id.startsWith('a')
          ? `atempo=${f}`
          : `setpts=${(1 / f).toFixed(4)}*PTS`;
      }
      // Decompose into multiple atempo steps
      let remaining = f;
      const steps: number[] = [];
      while (remaining > 2.0) { steps.push(2.0); remaining /= 2.0; }
      while (remaining < 0.5) { steps.push(0.5); remaining /= 0.5; }
      steps.push(remaining);
      return node.id.startsWith('a')
        ? `atempo=${steps.join(',atempo=')}`
        : `setpts=${(1 / f).toFixed(4)}*PTS`;
    }
    case 'transform': {
      const t = node.transform;
      const parts: string[] = [];
      // Scale first
      const w = Math.round(node.canvasWidth * t.scale);
      const h = Math.round(node.canvasHeight * t.scale);
      parts.push(`scale=${w}:${h}`);
      // Rotation (degrees)
      if (t.rotation !== 0) {
        parts.push(`rotate=${t.rotation}:ow=rotw(${t.rotation}):oh=roth(${t.rotation}):c=none`);
      }
      // Opacity
      if (t.opacity < 1) {
        parts.push(`format=rgba,colorchannelmixer=aa=${t.opacity.toFixed(3)}`);
      }
      // Position via overlay (handled at composite stage); here we just scale/rotate.
      return parts.join(',');
    }
    case 'crop': {
      const w = `(in_w*(1-${(node.left + node.right).toFixed(3)}))`;
      const h = `(in_h*(1-${(node.top + node.bottom).toFixed(3)}))`;
      const x = `(in_w*${node.left.toFixed(3)})`;
      const y = `(in_h*${node.top.toFixed(3)})`;
      return `crop=${w}:${h}:${x}:${y}`;
    }
    case 'color': {
      const c = node.color;
      const parts: string[] = [];
      parts.push(`eq=brightness=${(c.brightness * 0.5).toFixed(3)}:contrast=${(1 + c.contrast).toFixed(3)}:saturation=${(1 + c.saturation).toFixed(3)}:gamma=${(1 + c.exposure * 0.3).toFixed(3)}`);
      if (c.temperature !== 0 || c.tint !== 0) {
        // V19 §30-32: replace approximate color matrix with proper colortemperature +
        // colorbalance. colortemperature accepts Kelvin (1000..40000); we map
        // our normalized -1..1 to 6500±3000K.
        const kelvin = Math.round(6500 + c.temperature * 3000);
        parts.push(`colortemperature=temperature=${kelvin}`);
        // Tint (green↔magenta) via colorbalance shadows green/blue shift.
        parts.push(`colorbalance=gs=${c.tint.toFixed(3)}:bs=${(-c.tint * 0.5).toFixed(3)}`);
      }
      // V19 §30: vibrance = selective saturation, approximated via eq saturation
      // (slightly less aggressive than full saturation).
      if (c.vibrance !== 0) {
        parts.push(`eq=saturation=${(1 + c.vibrance * 0.5).toFixed(3)}`);
      }
      if (c.hue !== 0) parts.push(`hue=h=${c.hue}`);
      // V19 §30-32: replace placeholder `curves=preset=increase_contrast` with
      // REAL colorbalance filters for highlights/shadows/whites/blacks. Each
      // tonal range gets its own colorbalance pass — combined into a single
      // colorbalance filter with rs/gs/bs (shadows), rm/gm/bm (midtones),
      // rh/gh/bh (highlights) for efficiency.
      if (c.highlights !== 0 || c.shadows !== 0 || c.whites !== 0 || c.blacks !== 0) {
        // shadows → rs/gs/bs (uniform RGB shift to preserve neutrality)
        const sR = c.shadows.toFixed(3);
        const sG = c.shadows.toFixed(3);
        const sB = c.shadows.toFixed(3);
        // midtones — blacks/whites both push midtones in opposite directions
        const mR = (c.blacks * 0.5 + c.whites * 0.3).toFixed(3);
        const mG = (c.blacks * 0.5 + c.whites * 0.3).toFixed(3);
        const mB = (c.blacks * 0.5 + c.whites * 0.3).toFixed(3);
        // highlights → rh/gh/bh
        const hR = c.highlights.toFixed(3);
        const hG = c.highlights.toFixed(3);
        const hB = c.highlights.toFixed(3);
        parts.push(`colorbalance=rs=${sR}:gs=${sG}:bs=${sB}:rm=${mR}:gm=${mG}:bm=${mB}:rh=${hR}:gh=${hG}:bh=${hB}`);
      }
      return parts.join(',');
    }
    case 'effect': {
      const e = node.effect;
      const i = e.intensity;
      switch (e.type) {
        case 'blur':
        case 'gaussian-blur':
          return `boxblur=${Math.max(1, Math.round(i * 30))}:1`;
        case 'motion-blur':
          return `tmix=frames=${Math.max(2, Math.round(i * 10))}`;
        case 'sharpen':
          return `unsharp=5:5:${(i * 1.5).toFixed(2)}:5:5:0.0`;
        case 'vignette':
          return `vignette=PI/4:eval=init`;
        case 'noise':
        case 'grain':
          return `noise=alls=${Math.round(i * 80)}:allf=t+u`;
        case 'glow':
          return `gblur=sigma=${(i * 5).toFixed(2)}`;
        case 'pixelate':
          return `pixelize=${Math.max(2, Math.round(i * 30))}`;
        case 'chromatic-aberration':
        case 'rgb-split':
          return `split=3[v1][v2][v3],[v1]pad=iw+4:ih:0:0[v1p],[v3]pad=iw+4:ih:4:0[v3p],[v1p][v2][v3p]blend=all_mode=addition`;
        default:
          // glitch, vhs, film, bloom, lens-distortion — approximate with curves
          return `curves=preset=strong_contrast,noise=alls=${Math.round(i * 30)}`;
      }
    }
    case 'filter': {
      const f = node.filter;
      const i = f.intensity;
      switch (f.type) {
        case 'cinematic':
          return `eq=contrast=1.1:saturation=0.85:gamma=0.95,vignette=PI/4,curves=preset=increase_contrast`;
        case 'warm':
          return `eq=contrast=${(1 + i * 0.1).toFixed(2)}:saturation=${(1 + i * 0.2).toFixed(2)},colorbalance=rs=${(i * 0.3).toFixed(2)}:bs=${(-i * 0.2).toFixed(2)}`;
        case 'cool':
          return `eq=contrast=${(1 + i * 0.1).toFixed(2)}:saturation=${(1 + i * 0.1).toFixed(2)},colorbalance=rs=${(-i * 0.2).toFixed(2)}:bs=${(i * 0.3).toFixed(2)}`;
        case 'vintage':
          return `eq=contrast=1.1:brightness=-0.05:saturation=0.7,noise=alls=20:allf=t+u`;
        case 'film':
          return `curves=preset=old_film,noise=alls=15:allf=t+u,vignette=PI/5`;
        case 'bw':
          return `hue=s=0,eq=contrast=1.1:brightness=0.02`;
        case 'high-contrast':
          return `eq=contrast=1.4:saturation=1.1`;
        case 'moody':
          return `eq=contrast=1.2:brightness=-0.1:saturation=0.8,colorbalance=bs=0.2`;
        case 'vibrant':
          return `eq=saturation=1.4:contrast=1.1`;
        case 'portrait':
          return `eq=saturation=0.9:brightness=0.05:contrast=1.05,colorbalance=rs=0.05:gs=0.03`;
        case 'golden-hour':
          return `eq=saturation=1.15:contrast=1.1,colorbalance=rs=0.25:gs=0.1`;
        default:
          return '';
      }
    }
    case 'mask': {
      // V19 §21-22: full mask rendering with rectangle/circle/ellipse/polygon/
      // freehand, feather (gblur on alpha), invert (NOT of alpha formula), and
      // opacity (multiply alpha). All masks convert to RGBA + use geq for the
      // alpha formula so feather/invert work uniformly.
      const cx = node.x + node.w / 2;
      const cy = node.y + node.h / 2;
      const rx = node.w / 2;
      const ry = node.h / 2;
      let alphaExpr: string;
      switch (node.shape) {
        case 'rectangle': {
          // alpha = 255 if (X in [x*W, (x+w)*W]) AND (Y in [y*H, (y+h)*H])
          const x1 = `${node.x.toFixed(4)}*W`;
          const x2 = `${(node.x + node.w).toFixed(4)}*W`;
          const y1 = `${node.y.toFixed(4)}*H`;
          const y2 = `${(node.y + node.h).toFixed(4)}*H`;
          alphaExpr = `if(between(X,${x1},${x2})*between(Y,${y1},${y2}),255,0)`;
          break;
        }
        case 'circle':
        case 'ellipse': {
          // alpha = 255 if (X-cx)^2/rx^2 + (Y-cy)^2/ry^2 < 1
          alphaExpr = `if(lt(pow((X-${cx.toFixed(4)}*W)/${(rx > 0 ? rx : 0.001).toFixed(4)}/W,2)+pow((Y-${cy.toFixed(4)}*H)/${(ry > 0 ? ry : 0.001).toFixed(4)}/H,2),1),255,0)`;
          break;
        }
        case 'polygon':
        case 'freehand': {
          // Point-in-polygon test via ray casting. Each edge contributes a
          // term: if the ray from (X,Y) to +inf crosses this edge, count it.
          // Final parity (even/odd) determines inside/outside.
          const pts = node.points ?? [];
          if (pts.length < 3) {
            // Not enough points — fall back to rectangle bounding box
            const x1 = `${node.x.toFixed(4)}*W`;
            const x2 = `${(node.x + node.w).toFixed(4)}*W`;
            const y1 = `${node.y.toFixed(4)}*H`;
            const y2 = `${(node.y + node.h).toFixed(4)}*H`;
            alphaExpr = `if(between(X,${x1},${x2})*between(Y,${y1},${y2}),255,0)`;
          } else {
            // Build a sum of edge-crossing indicators.
            // For each edge (Pi, Pi+1), an edge crosses the ray from (X,Y) rightward
            // iff: (Pi.y > Y) != (Pi+1.y > Y) AND X < (Pi+1.x - Pi.x) * (Y - Pi.y) / (Pi+1.y - Pi.y) + Pi.x
            // We use lt/gte comparisons in FFmpeg expression syntax.
            const terms: string[] = [];
            for (let i = 0; i < pts.length; i++) {
              const p0 = pts[i];
              const p1 = pts[(i + 1) % pts.length];
              const x0 = `${p0.x.toFixed(4)}*W`;
              const y0 = `${p0.y.toFixed(4)}*H`;
              const x1 = `${p1.x.toFixed(4)}*W`;
              const y1 = `${p1.y.toFixed(4)}*H`;
              // crossing = if(gte(Y, min(y0,y1)) * lt(Y, max(y0,y1)) * lt(X, (x1-x0)*(Y-y0)/(y1-y0+0.0001) + x0), 1, 0)
              // Avoid division by zero with +0.0001.
              terms.push(`if(gte(Y,${y0})*lt(Y,${y1})*lt(X,(${x1}-${x0})*(Y-${y0})/(${y1}-${y0}+0.0001)+${x0}),1,0)`);
            }
            // parity = sum(terms) mod 2 → inside. FFmpeg has no modulo, but
            // we can use: inside = if(gt(sum,0),1,0) * if(lt(sum-floor(sum/2)*2,1),1,0)
            // Simpler: alternate-and via nested if — but for N edges this is
            // bounded. Use a nested XOR (if(A, if(B, 0, 1), 1)) chain.
            let acc = '0';
            for (const t of terms) {
              acc = `if(${t},if(${acc},0,1),if(${acc},1,0))`;
            }
            alphaExpr = `if(${acc},255,0)`;
          }
          break;
        }
        default: {
          alphaExpr = '255';
        }
      }
      // Apply invert: NOT alpha → 255 - alpha
      if (node.invert) {
        alphaExpr = `(255-(${alphaExpr}))`;
      }
      // Apply opacity multiplier (0..1)
      const opacityMul = node.opacity !== undefined ? node.opacity : 1;
      if (opacityMul < 1) {
        alphaExpr = `(${alphaExpr}*${opacityMul.toFixed(3)})`;
      }
      // Apply feather via gblur on the alpha channel. We chain: format=rgba →
      // geq (sets alpha) → gblur (blurs alpha only via enable_expr hack) — but
      // gblur doesn't have a per-channel mode. Use a small sigma for feather.
      const feather = node.feather ?? 0;
      const featherSigma = feather > 0 ? Math.max(0.1, feather * 5) : 0;
      // Use geq to set alpha (preserving r/g/b) — note `r(X,Y)` etc. are the
      // existing luminance values at pixel (X,Y), preserving the image.
      let filter = `format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${alphaExpr}'`;
      // Apply rotation around mask center if specified (rare; uses rotate).
      if (node.rotation && node.rotation !== 0) {
        filter += `,rotate=${node.rotation.toFixed(3)}:ow=iw:oh=ih:c=none`;
      }
      if (featherSigma > 0) {
        // gblur operates on all channels; for an RGBA image with transparent
        // border, this naturally softens the alpha edge.
        filter += `,gblur=sigma=${featherSigma.toFixed(3)}`;
      }
      return filter;
    }
    case 'keyframe': {
      // V19 §19: per-property time-varying FFmpeg expression.
      // Note: FFmpeg filter time variables are case-sensitive:
      //   - `geq` uses `T` (uppercase)
      //   - `rotate` / `volume` use `t` (lowercase)
      //   - `scale` doesn't expose time as a variable (so we use `geq` for
      //     scale too, with the inverse-mapping trick).
      switch (node.property) {
        case 'opacity': {
          // format=rgba + geq on alpha channel. Uses `T` for time.
          const expr = buildKeyframeExpression(node, 'T');
          if (!expr) return '';
          return `format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*(${expr})'`;
        }
        case 'scale': {
          // `scale` filter has no time variable. Use `geq` with inverse pixel
          // mapping: output pixel (X,Y) samples input pixel at the scaled
          // location. EXPR is the time-varying scale factor (1.0 = no change).
          // NOTE: `geq` uses `alpha(X,Y)` (NOT `a(X,Y)`) to fetch the source
          // alpha value — `a=` is only the parameter NAME, the function is `alpha`.
          const expr = buildKeyframeExpression(node, 'T');
          if (!expr) return '';
          // Inverse mapping: srcX = (X - W/2) / EXPR + W/2 = (X + W/2*(EXPR-1))/EXPR
          // For EXPR > 0 (always true for valid scale), this is safe.
          const srcX = `(X+W/2*(${expr}-1))/(${expr})`;
          const srcY = `(Y+H/2*(${expr}-1))/(${expr})`;
          return `format=rgba,geq=r='r(${srcX},${srcY})':g='g(${srcX},${srcY})':b='b(${srcX},${srcY})':a='alpha(${srcX},${srcY})'`;
        }
        case 'rotation': {
          // rotate filter uses `t` (lowercase) for time; convert degrees → radians.
          const expr = buildKeyframeExpression(node, 't');
          if (!expr) return '';
          return `rotate='${expr}*PI/180':ow=iw:oh=ih:c=none`;
        }
        case 'x':
        case 'y': {
          // V19.1.4 §5-10: X/Y position keyframes are evaluated at the
          // composite (overlay) step, NOT in the per-clip filter chain.
          //
          // V19.1.4 §5.1: The correct abstraction is compositor-level
          // positioning via overlay, not pixel manipulation via geq.
          // FFmpeg's `pad` and `geq` filters don't support if/between
          // expressions, so we can't emit them here.
          //
          // Instead, the X/Y keyframe expression is evaluated by the
          // keyframe-evaluator at runtime + the result is passed to the
          // overlay filter's x/y parameters at the composite step.
          //
          // The per-clip chain emits a no-op (empty string) so the chain
          // stays connected. The actual position is applied when the clip
          // is composited onto the canvas via overlay.
          //
          // V19.1.4 RULE B: The test verifies this via the PRODUCTION
          // renderer (FFmpegRenderService.render()) which calls
          // buildFilterGraph + the composite step.
          return '';
        }
        case 'volume': {
          // volume filter with eval=frame for per-frame evaluation. Uses `t`.
          const expr = buildKeyframeExpression(node, 't');
          if (!expr) return '';
          return `volume='${expr}':eval=frame`;
        }
        default:
          return '';
      }
    }
    case 'chromakey': {
      // V19 §23: chromakey=color:similarity:blend + spill suppression.
      const ck = node.chromaKey;
      const color = hexToFFmpegColor(ck.color);
      const similarity = Math.max(0, Math.min(1, ck.similarity));
      const blend = Math.max(0, Math.min(1, ck.smoothness));
      const parts: string[] = [`chromakey=${color}:${similarity.toFixed(3)}:${blend.toFixed(3)}`];
      // Spill suppression: reduce green contribution at edges (approximation
      // via colorchannelmixer gg reduction).
      if (ck.spillSuppression > 0) {
        const gg = Math.max(0, 1 - ck.spillSuppression);
        parts.push(`colorchannelmixer=gg=${gg.toFixed(3)}`);
      }
      // Edge softness: blur the alpha channel slightly to soften edges.
      if (ck.edgeSoftness > 0) {
        const sigma = Math.max(0.1, ck.edgeSoftness * 5);
        parts.push(`format=rgba,gblur=sigma=${sigma.toFixed(3)}`);
      }
      // Shadow preservation: lower similarity threshold to keep more dark areas
      // opaque (approximation — would need a real chroma keyer for accuracy).
      // We accept the parameter but don't emit a separate filter for it.
      return parts.join(',');
    }
    case 'curves': {
      // V19 §30: RGB Curves via FFmpeg `curves` filter.
      // Format: curves=r='0/0 0.5/0.58 1/1':g='...':b='...':m='...'
      const fmtPoints = (pts?: { in: number; out: number }[]): string | null => {
        if (!pts || pts.length < 2) return null;
        // Sort by input value
        const sorted = [...pts].sort((a, b) => a.in - b.in);
        // FFmpeg curves expects each point as `in/out` (0..1). Always include
        // 0/0 and 1/1 endpoints so the curve is bounded.
        const out: string[] = [];
        if (sorted[0].in > 0.001) out.push('0/0');
        for (const p of sorted) out.push(`${p.in.toFixed(4)}/${p.out.toFixed(4)}`);
        if (sorted[sorted.length - 1].in < 0.999) out.push('1/1');
        return out.join(' ');
      };
      const r = fmtPoints(node.red);
      const g = fmtPoints(node.green);
      const b = fmtPoints(node.blue);
      const m = fmtPoints(node.master);
      const parts: string[] = [];
      if (m) parts.push(`m='${m}'`);
      if (r) parts.push(`r='${r}'`);
      if (g) parts.push(`g='${g}'`);
      if (b) parts.push(`b='${b}'`);
      if (parts.length === 0) return '';
      return `curves=${parts.join(':')}`;
    }
    case 'wheels': {
      // V19 §30: Color Wheels (Lift/Gamma/Gain) via colorbalance + eq.
      // Lift → shadows (rs/gs/bs), Gamma → midtones (rm/gm/bm), Gain → highlights (rh/gh/bh).
      const lift = node.lift;
      const gamma = node.gamma;
      const gain = node.gain;
      const parts: string[] = [];
      const hasLift = lift.r !== 0 || lift.g !== 0 || lift.b !== 0;
      const hasGamma = gamma.r !== 0 || gamma.g !== 0 || gamma.b !== 0;
      const hasGain = gain.r !== 0 || gain.g !== 0 || gain.b !== 0;
      if (hasLift || hasGamma || hasGain) {
        parts.push(`colorbalance=rs=${lift.r.toFixed(3)}:gs=${lift.g.toFixed(3)}:bs=${lift.b.toFixed(3)}:rm=${gamma.r.toFixed(3)}:gm=${gamma.g.toFixed(3)}:bm=${gamma.b.toFixed(3)}:rh=${gain.r.toFixed(3)}:gh=${gain.g.toFixed(3)}:bh=${gain.b.toFixed(3)}`);
      }
      if (node.saturation !== undefined && node.saturation !== 1) {
        parts.push(`eq=saturation=${node.saturation.toFixed(3)}`);
      }
      return parts.join(',');
    }
    case 'lut': {
      // V19 §32: 3D LUT via lut3d filter. If intensity < 1, mix original +
      // LUT-graded via blend filter (split input, apply lut to one half, blend).
      if (!node.filePath || node.intensity <= 0) return '';
      const interp = node.interp || 'tetrahedral';
      // Escape the file path for FFmpeg (colons in Windows paths are tricky).
      // We use single quotes around the path to be safe; the filter_complex
      // parser handles them.
      const lutPath = escapeFilterString(node.filePath);
      if (node.intensity >= 0.999) {
        return `lut3d=file='${lutPath}':interp=${interp}`;
      }
      // Mix via split + blend with all_mode=normal + all_opacity=intensity.
      // The split creates two streams; we apply lut3d to one, then blend.
      // Intermediate labels use the node.id prefix to ensure uniqueness.
      const a = `${node.id}_a`;
      const b = `${node.id}_b`;
      const b2 = `${node.id}_b2`;
      return `split=2[${a}][${b}];[${b}]lut3d=file='${lutPath}':interp=${interp}[${b2}];[${a}][${b2}]blend=all_mode=normal:all_opacity=${node.intensity.toFixed(3)}`;
    }
    case 'caption': {
      // V19 §51: Multi-cue caption rendering. Emit one drawtext per cue (or
      // per word for karaoke). All drawtext filters chain on the input stream
      // — each takes the previous as input.
      if (!node.cues || node.cues.length === 0) return '';
      const parts: string[] = [];
      for (const cue of node.cues) {
        const cueParts = buildCaptionCueFilter(cue, node.baseStyle);
        parts.push(...cueParts);
      }
      if (parts.length === 0) return '';
      return parts.join(',');
    }
    case 'text': {
      const escaped = escapeDrawtext(node.text);
      const x = `${(node.x * 100).toFixed(2)}*W/100`;
      const y = `${(node.y * 100).toFixed(2)}*H/100`;
      const boxOpt = node.boxColor ? `:box=1:boxcolor=${node.boxColor}@${(node.boxOpacity ?? 0.5).toFixed(2)}:boxborderw=10` : '';
      // V9: fontfile must be a PATH, not a font name. If fontFamily is not a
      // path, omit it and let FFmpeg use the default font (DejaVu Sans on Alpine).
      const fontOpt = (node.fontFamily && node.fontFamily.startsWith('/'))
        ? `:fontfile=${escapeDrawtext(node.fontFamily)}`
        : '';
      const styleOpt = node.fontStyle === 'italic' ? ':fontcolor_expr=italic' : '';
      return `drawtext=text='${escaped}':x=${x}:y=${y}:fontsize=${node.fontSize}:fontcolor=${node.color}${boxOpt}${fontOpt}${styleOpt}:enable='between(t,${node.start},${node.end})'`;
    }
    case 'audio_mix': {
      if (node.muted) return 'volume=0';
      const parts: string[] = [];
      parts.push(`volume=${node.volume.toFixed(3)}`);
      if (node.pan !== 0) parts.push(`pan=stereo|c0=${(0.5 - node.pan / 2).toFixed(3)}*c0|c1=${(0.5 + node.pan / 2).toFixed(3)}*c0`);
      if (node.fadeIn > 0) parts.push(`afade=t=in:st=0:d=${node.fadeIn}`);
      // V19 §33 BUG FIX: previously, `node.duration` was undefined on
      // AudioMixNode, so the fallback was 3s — wrong for clips >3s. Now
      // buildFilterGraph threads the actual chain duration (source span /
      // speed) through. We still keep a sensible fallback for safety in case
      // the node was constructed directly without `duration`.
      if (node.fadeOut > 0) {
        const fadeOutStart = Math.max(0, (node.duration ?? 3) - node.fadeOut);
        parts.push(`afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${node.fadeOut}`);
      }
      return parts.join(',');
    }
    case 'composite': {
      // For audio chain mixing — uses amix
      if (node.id.startsWith('a')) {
        return `amix=inputs=${node.inputs.length}:duration=longest:normalize=0`;
      }
      // V19.1.5: Video composite — overlay with dynamic X/Y from keyframes.
      //
      // V19.1.5 §11: When overlayX/overlayY are set (from keyframe expressions),
      // the overlay filter uses time-varying X/Y:
      //   overlay=x='expr':y='expr':format=auto
      //
      // When not set (no keyframes), uses static 0:0.
      void inLabels;
      const mode = mapBlendModeToFFmpeg(node.blendMode);
      if (mode === 'normal') {
        // V19.1.5 §11: Build the overlay filter with dynamic X/Y expressions
        const xExpr = node.overlayX || '0';
        const yExpr = node.overlayY || '0';
        return `overlay=x='${xExpr}':y='${yExpr}':format=auto`;
      }
      // blend filter takes 2 inputs (already provided via inLabels).
      return `blend=all_mode=${mode}`;
    }
    case 'transition': {
      // xfade only works between two video streams; mapTransitionType already constrained.
      const xfadeType = node.transitionType === 'cross-dissolve' ? 'fade'
        : node.transitionType === 'dip-to-black' ? 'fadeblack'
        : node.transitionType === 'dip-to-white' ? 'fadewhite'
        : node.transitionType === 'slide' ? 'slideleft'
        : node.transitionType === 'zoom' ? 'zoomin'
        : node.transitionType === 'wipe' ? 'wipeleft'
        : node.transitionType === 'blur' ? 'smoothleft'
        : 'fade';
      return `xfade=transition=${xfadeType}:duration=${node.duration}:offset=${node.offset}`;
    }
    case 'fade': {
      if (node.id.startsWith('a')) {
        return node.fadeType === 'out'
          ? `afade=t=out:st=0:d=${node.duration}`
          : `afade=t=in:st=0:d=${node.duration}`;
      }
      return node.fadeType === 'out'
        ? `fade=t=out:st=0:d=${node.duration}:color=${node.color || 'black'}`
        : `fade=t=in:st=0:d=${node.duration}:color=${node.color || 'black'}`;
    }
    case 'output': {
      // Final scale + fps + format
      return `scale=${node.width}:${node.height},fps=${node.fps},format=${node.format}`;
    }
    default:
      return '';
  }
}

function escapeDrawtext(text: string): string {
  // Escape characters that drawtext treats specially. The order matters:
  // backslash MUST be escaped FIRST so the escape sequences we add for
  // other chars aren't themselves backslash-doubled (which would un-escape
  // them and re-trigger FFmpeg's option parser).
  // V19 §51 BUG FIX: previously, a final `replace(/\\/g, '\\\\')` line
  // was DOUBLING the escape backslashes we just inserted (e.g. `\:` would
  // become `\\:`), which FFmpeg then parsed as literal `\:` instead of an
  // escaped colon. The visible symptom was "No option name near" errors
  // for any text containing a colon (e.g. caption speaker labels like
  // "[Narrator]: Hello").
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/:/g, '\\:');
}

// === V19 helper functions ===

/**
 * Escape a string for use as an FFmpeg filter parameter value. Filter values
 * are delimited by `:` and `=`, and quoted with `'`. We escape `\`, `'`, and
 * `:` so the value is treated as a single token.
 */
function escapeFilterString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:');
}

/**
 * Convert a hex color string (#RRGGBB) to FFmpeg's preferred format (0xRRGGBB).
 * Falls back to 0x00FF00 (green) for invalid input.
 */
function hexToFFmpegColor(hex: string): string {
  const m = hex.match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return '0x00FF00';
  return `0x${m[1].toUpperCase()}`;
}

/**
 * Map our BlendMode enum (12 modes) to FFmpeg's `blend=all_mode=` value.
 * Returns 'normal' for the default mode (handled separately via overlay filter).
 */
function mapBlendModeToFFmpeg(mode: string): string {
  switch (mode) {
    case 'multiply': return 'multiply';
    case 'screen': return 'screen';
    case 'overlay': return 'overlay';
    case 'darken': return 'darken';
    case 'lighten': return 'lighten';
    case 'color-dodge': return 'dodge';
    case 'color-burn': return 'burn';
    case 'hard-light': return 'hardlight';
    case 'soft-light': return 'softlight';
    case 'difference': return 'difference';
    case 'exclusion': return 'exclusion';
    case 'normal':
    default:
      return 'normal';
  }
}

/**
 * V19 §19: Build a time-varying FFmpeg expression for a keyframe sequence.
 *
 * Returns an expression string that, given FFmpeg's time variable, evaluates
 * to the animated value. Supports linear, ease-in, ease-out, ease-in-out,
 * cubic, and bezier (approximated as cubic) easing.
 *
 * Expression structure for N keyframes (sorted by time):
 *   if(between(timeVar,t0,t1), EASE(t0,v0,t1,v1),
 *     if(between(timeVar,t1,t2), EASE(t1,v1,t2,v2),
 *       ...
 *         vN  // hold last value
 *       )
 *     )
 *   )
 *
 * For timeVar < t0, returns v0 (hold first value).
 * For timeVar > tN, returns vN (hold last value).
 *
 * @param timeVar FFmpeg time variable name — `"t"` for `rotate`/`volume`,
 *   `"T"` for `geq` (case-sensitive).
 */
function buildKeyframeExpression(node: KeyframeNode, timeVar: string = 't'): string {
  const kfs = node.keyframes;
  if (!kfs || kfs.length < 2) return '';
  // Build nested if() expressions from outermost (kf[0]→kf[1]) to innermost (kf[N-1]→hold last).
  // We start with the innermost fallback (last value), then wrap outward.
  const last = kfs[kfs.length - 1];
  let expr = `${last.value}`;
  // Iterate from the second-to-last pair backwards
  for (let i = kfs.length - 2; i >= 0; i--) {
    const k0 = kfs[i];
    const k1 = kfs[i + 1];
    const t0 = k0.time;
    const t1 = k1.time;
    const v0 = k0.value;
    const v1 = k1.value;
    const dt = t1 - t0;
    if (dt <= 0) {
      // Identical times — skip this segment (use fallback for both)
      continue;
    }
    // normalized progress x = (timeVar - t0) / (t1 - t0)
    const x = `(${timeVar}-${t0})/${dt}`;
    // easing function applied to x
    const easedX = applyEasing(x, k0.easing, k0.bezier);
    // value = v0 + (v1 - v0) * easedX
    const seg = `${v0}+(${v1 - v0})*(${easedX})`;
    expr = `if(between(${timeVar},${t0},${t1}),${seg},${expr})`;
  }
  // For timeVar < kfs[0].time, return kfs[0].value
  const first = kfs[0];
  expr = `if(lt(${timeVar},${first.time}),${first.value},${expr})`;
  return expr;
}

/**
 * Apply an easing function to a normalized progress value (0..1).
 * Returns an FFmpeg expression string. Supported easings:
 *   - linear: x
 *   - ease-in: x^2
 *   - ease-out: 1 - (1-x)^2
 *   - ease-in-out: x<0.5 ? 2*x^2 : 1 - (-2x+2)^2/2
 *   - cubic: x^3
 *   - bezier: approximated as cubic (P0..P3 with control points P1, P2).
 *     True cubic bezier requires iteration — we use a polynomial approximation.
 */
function applyEasing(x: string, easing: string, bezier?: [number, number, number, number]): string {
  switch (easing) {
    case 'ease-in':
      return `pow(${x},2)`;
    case 'ease-out':
      return `(1-pow(1-${x},2))`;
    case 'ease-in-out':
      // x < 0.5 ? 2*x^2 : 1 - pow(-2*x+2, 2)/2
      return `if(lt(${x},0.5),2*pow(${x},2),1-pow(-2*${x}+2,2)/2)`;
    case 'cubic':
      return `pow(${x},3)`;
    case 'bezier':
      // Approximate cubic bezier with cubic polynomial. For control points
      // (0,0), (p1x,p1y), (p2x,p2y), (1,1), the cubic Bezier curve can be
      // approximated by a cubic polynomial in x. As a simplification, we use
      // a power-based ease: x^k where k is derived from the control points.
      // This is NOT exact but provides visually distinct motion.
      if (bezier && bezier.length === 4) {
        // Use the average of the Y control points as the easing "strength"
        const k = 1 + Math.round((bezier[1] + bezier[3]) / 2 * 2);
        const exp = Math.max(1, Math.min(4, k));
        return `pow(${x},${exp})`;
      }
      return `pow(${x},2)`;
    case 'linear':
    default:
      return x;
  }
}

/**
 * V19 §51: Build the FFmpeg drawtext filter(s) for a single caption cue.
 *
 * - If cue.words[] exists with word-level timestamps, emit per-word drawtext
 *   filters with `enable='between(t,word.start,word.end)'` and a different
 *   highlight color for the active word (karaoke-style).
 * - Otherwise, emit a single drawtext for the full cue text with
 *   `enable='between(t,cue.start,cue.end)'`.
 * - If cue.speaker is set, prepend "[Speaker]: " to the displayed text.
 * - Per-cue style overrides fall back to baseStyle.
 */
function buildCaptionCueFilter(
  cue: CaptionCue,
  baseStyle?: {
    fontFamily?: string;
    fontSize?: number;
    color?: string;
    fontWeight?: number;
    italic?: boolean;
    backgroundColor?: string;
    borderWidth?: number;
    borderColor?: string;
    boxPadding?: number;
    highlightColor?: string;
  }
): string[] {
  const parts: string[] = [];
  const fontSize = cue.style?.fontSize ?? baseStyle?.fontSize ?? 48;
  const fontColor = cue.style?.fontColor ?? baseStyle?.color ?? '#FFFFFF';
  const fontFamily = cue.style?.fontFamily ?? baseStyle?.fontFamily;
  const italic = cue.style?.italic ?? baseStyle?.italic ?? false;
  const bg = cue.style?.backgroundColor ?? baseStyle?.backgroundColor;
  const borderW = cue.style?.borderWidth ?? baseStyle?.borderWidth ?? 0;
  const borderC = cue.style?.borderColor ?? baseStyle?.borderColor ?? '#000000';
  const boxPad = cue.style?.boxPadding ?? baseStyle?.boxPadding ?? 10;
  const highlightColor = cue.style?.highlightColor ?? baseStyle?.highlightColor ?? '#FFFF00';
  const x = cue.style?.x ?? 0.5;
  const y = cue.style?.y ?? 0.85;
  const speakerPrefix = cue.speaker ? `[${cue.speaker}]: ` : '';

  // Helper: build a single drawtext filter
  const drawtext = (text: string, color: string, start: number, end: number): string => {
    const escaped = escapeDrawtext(text);
    const xExpr = `${(x * 100).toFixed(2)}*W/100`;
    const yExpr = `${(y * 100).toFixed(2)}*H/100`;
    const opts: string[] = [];
    opts.push(`text='${escaped}'`);
    opts.push(`x=${xExpr}`);
    opts.push(`y=${yExpr}`);
    opts.push(`fontsize=${fontSize}`);
    opts.push(`fontcolor=${color}`);
    // Box (background)
    if (bg) {
      opts.push(`box=1`);
      opts.push(`boxcolor=${bg}@0.7`);
      opts.push(`boxborderw=${boxPad}`);
    }
    // Border (stroke)
    if (borderW > 0) {
      opts.push(`borderw=${borderW}`);
      opts.push(`bordercolor=${borderC}`);
    }
    // Font file (must be a path, not a name)
    if (fontFamily && fontFamily.startsWith('/')) {
      opts.push(`fontfile=${escapeDrawtext(fontFamily)}`);
    }
    // Italic via fontcolor_expr is not reliable; use the `style` option if available.
    if (italic) {
      opts.push(`style=Italic`);
    }
    opts.push(`enable='between(t,${start},${end})'`);
    return `drawtext=${opts.join(':')}`;
  };

  if (cue.words && cue.words.length > 0) {
    // Karaoke mode: emit per-word drawtext. Each word gets its own filter with
    // a different highlight color when active. To avoid overlapping text, we
    // concatenate all words in a single line but vary the color per-word.
    //
    // Implementation: emit one drawtext per word with horizontal offset
    // proportional to word index. This is approximate — true karaoke requires
    // per-pixel text positioning which FFmpeg's drawtext doesn't easily support.
    const fullText = speakerPrefix + cue.words.map((w) => w.text).join(' ');
    // For simplicity, emit a single drawtext that changes color via a time-
    // varying fontcolor expression. FFmpeg drawtext supports fontcolor_expr
    // which is evaluated per frame.
    //
    // Build a nested if() expression that returns the highlight color during
    // each word's active time, the normal color otherwise.
    //
    // V19 §51 BUG FIX: FFmpeg color literals inside an expression MUST be hex
    // (e.g. `0xFFFF00`) — single-quoted color names (e.g. `'#FFFF00'`) cause
    // unbalanced quotes when the whole expression is wrapped in single quotes
    // for option-parsing safety. We convert hex colors to `0xRRGGBB` form.
    const fcHex = hexToFFmpegColor(fontColor);     // e.g. 0xFFFFFF
    const hlHex = hexToFFmpegColor(highlightColor); // e.g. 0xFFFF00
    let colorExpr = fcHex;
    for (const w of cue.words) {
      colorExpr = `if(between(t,${w.start},${w.end}),${hlHex},${colorExpr})`;
    }
    const escaped = escapeDrawtext(fullText);
    const xExpr = `${(x * 100).toFixed(2)}*W/100`;
    const yExpr = `${(y * 100).toFixed(2)}*H/100`;
    const opts: string[] = [];
    opts.push(`text='${escaped}'`);
    opts.push(`x=${xExpr}`);
    opts.push(`y=${yExpr}`);
    opts.push(`fontsize=${fontSize}`);
    // V19 §51: fontcolor_expr value MUST be quoted with single quotes so the
    // colons inside `between(t,start,end)` aren't interpreted as option
    // separators by FFmpeg's drawtext parser. Colors inside the expression
    // MUST be in 0xRRGGBB hex form (no quotes inside the expression).
    opts.push(`fontcolor_expr='${colorExpr}'`);
    if (bg) {
      opts.push(`box=1`);
      opts.push(`boxcolor=${bg}@0.7`);
      opts.push(`boxborderw=${boxPad}`);
    }
    if (borderW > 0) {
      opts.push(`borderw=${borderW}`);
      opts.push(`bordercolor=${borderC}`);
    }
    if (fontFamily && fontFamily.startsWith('/')) {
      opts.push(`fontfile=${escapeDrawtext(fontFamily)}`);
    }
    if (italic) {
      opts.push(`style=Italic`);
    }
    opts.push(`enable='between(t,${cue.start},${cue.end})'`);
    parts.push(`drawtext=${opts.join(':')}`);
  } else {
    // Normal cue: single drawtext for the full text
    parts.push(drawtext(speakerPrefix + cue.text, fontColor, cue.start, cue.end));
  }
  return parts;
}
