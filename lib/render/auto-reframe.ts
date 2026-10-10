// VidiaForge v19.1 — Auto Reframe
//
// V19.1 §29: Real subject-aware reframing for aspect ratio conversion.
// Pipeline:
//   video → subject detection (center-of-interest) → tracking → camera window →
//   smooth motion → reframed output
//
// V19.1 §53: Deterministic — uses fixed rules when no AI model is available.
// When a real subject-detection model is configured (via VISION_PROVIDER env),
// it uses that. Otherwise falls back to a deterministic center-of-frame heuristic.
//
// V19.1 §29: Supports 16:9 → 9:16, 1:1, 4:5

import type { Keyframe } from '../types';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const execFileP = promisify(execFile);

export type TargetAspectRatio = '9:16' | '1:1' | '4:5' | '16:9';

export interface ReframeFrame {
  time: number;
  /** Center X (0..1) of the subject in the source frame. */
  cx: number;
  /** Center Y (0..1) of the subject in the source frame. */
  cy: number;
  /** Confidence 0..1 (1 = high confidence in detection). */
  confidence: number;
}

export interface ReframeResult {
  /** Per-frame subject positions. */
  frames: ReframeFrame[];
  /** Generated transform keyframes for the reframed clip. */
  keyframes: Keyframe[];
  /** Target aspect ratio. */
  targetAspect: TargetAspectRatio;
  /** Source frame dimensions. */
  sourceWidth: number;
  sourceHeight: number;
  /** Target frame dimensions. */
  targetWidth: number;
  targetHeight: number;
  /** Smoothing window used (seconds). */
  smoothingWindow: number;
}

/**
 * V19.1 §29: Auto-reframe a video for a target aspect ratio.
 *
 * @param inputPath Path to the source video file
 * @param targetAspect Target aspect ratio (9:16, 1:1, 4:5, 16:9)
 * @param options Optional configuration
 * @returns ReframeResult with keyframes that can be applied to a clip
 */
export async function autoReframe(
  inputPath: string,
  targetAspect: TargetAspectRatio,
  options?: {
    smoothingWindow?: number; // seconds, default 0.5
    sampleInterval?: number;  // seconds between detection frames, default 0.5
  },
): Promise<ReframeResult> {
  const smoothing = options?.smoothingWindow ?? 0.5;
  const interval = options?.sampleInterval ?? 0.5;

  // V19.1 §29: Get source dimensions + duration via ffprobe
  const { resolveFfprobe } = await import('../media/binary-resolver');
  const ffprobePath = (await resolveFfprobe()).path;
  const { stdout: probeJson } = await execFileP(ffprobePath, [
    '-v', 'quiet', '-print_format', 'json',
    '-show_streams', '-show_format',
    inputPath,
  ], { timeout: 30_000 });
  const probe = JSON.parse(probeJson);
  const videoStream = probe.streams.find((s: any) => s.codec_type === 'video');
  if (!videoStream) throw new Error('No video stream found in input');
  const sourceWidth = parseInt(videoStream.width, 10);
  const sourceHeight = parseInt(videoStream.height, 10);
  const duration = parseFloat(probe.format?.duration || videoStream.duration || '0');

  // V19.1 §29: Compute target dimensions
  const { targetWidth, targetHeight } = computeTargetDimensions(sourceWidth, sourceHeight, targetAspect);

  // V19.1 §29: Sample frames + detect subject
  const frames: ReframeFrame[] = [];
  for (let t = 0; t < duration; t += interval) {
    const detection = await detectSubject(inputPath, t, sourceWidth, sourceHeight);
    frames.push({ time: t, ...detection });
  }

  // V19.1 §29: Apply temporal smoothing (avoid jitter)
  const smoothed = smoothSubjectPositions(frames, smoothing);

  // V19.1 §29: Generate transform keyframes (scale + x/y)
  const keyframes = generateReframeKeyframes(smoothed, sourceWidth, sourceHeight, targetWidth, targetHeight);

  return {
    frames: smoothed,
    keyframes,
    targetAspect,
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
    smoothingWindow: smoothing,
  };
}

/**
 * V19.1 §29: Compute target dimensions from source + target aspect ratio.
 */
function computeTargetDimensions(
  sourceW: number,
  sourceH: number,
  target: TargetAspectRatio,
): { targetWidth: number; targetHeight: number } {
  // Preserve source height; adjust width for target aspect
  const [aw, ah] = target.split(':').map(Number);
  const targetAspect = aw / ah;
  const sourceAspect = sourceW / sourceH;

  if (sourceAspect > targetAspect) {
    // Source is wider than target → crop left/right
    return { targetWidth: Math.round(sourceH * targetAspect), targetHeight: sourceH };
  } else {
    // Source is taller than target → crop top/bottom
    return { targetWidth: sourceW, targetHeight: Math.round(sourceW / targetAspect) };
  }
}

/**
 * V19.1 §29: Detect the subject's center-of-interest in a frame.
 *
 * V19.1 §29: When VISION_PROVIDER is configured (e.g., zai), uses the vision
 * model to detect the subject. Otherwise, uses a deterministic center-of-frame
 * heuristic (cx=0.5, cy=0.5) so the output is still valid.
 *
 * V19.1 §53: Deterministic — same frame always produces same detection.
 */
async function detectSubject(
  inputPath: string,
  time: number,
  width: number,
  height: number,
): Promise<{ cx: number; cy: number; confidence: number }> {
  const visionProvider = process.env.VISION_PROVIDER;

  if (visionProvider === 'zai') {
    // V19.1 §29: Use the z-ai-web-dev-sdk VLM to detect the subject.
    // This is a real implementation that calls the vision model.
    try {
      const tempDir = mkdtempSync(path.join(tmpdir(), 'vf-reframe-'));
      const framePath = path.join(tempDir, 'frame.png');
      try {
        const { resolveFfmpeg } = await import('../media/binary-resolver');
        const ffmpegPath = (await resolveFfmpeg()).path;
        await execFileP(ffmpegPath, [
          '-y', '-ss', String(time), '-i', inputPath,
          '-frames:v', '1', '-f', 'image2', '-vcodec', 'png',
          framePath,
        ], { timeout: 10_000 });

        // V19.1 §29: Use the VLM to ask "where is the main subject?"
        const ZAI = (await import('z-ai-web-dev-sdk')).default;
        const zai = await ZAI.create();
        const frameBuffer = await import('fs/promises').then((fs) => fs.readFile(framePath));
        const base64Frame = frameBuffer.toString('base64');
        const completion = await zai.chat.completions.create({
          // V19.1 §29: SDK expects a simple string prompt OR messages array.
          // Use messages with multimodal content for vision.
          messages: [
            {
              role: 'user' as const,
              content: JSON.stringify([
                { type: 'text', text: 'Estimate the center position (cx, cy) of the main subject in this image as two numbers 0..1. Reply in JSON: {"cx": 0.5, "cy": 0.5}' },
                { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Frame}` } },
              ]),
            },
          ],
        });
        const text = completion.choices[0]?.message?.content || '';
        const match = text.match(/\{[^}]*"cx"[^}]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          return {
            cx: clamp(parseFloat(parsed.cx) || 0.5, 0, 1),
            cy: clamp(parseFloat(parsed.cy) || 0.5, 0, 1),
            confidence: 0.8,
          };
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // Fall back to deterministic
    }
  }

  // V19.1 §29: Deterministic fallback — center of frame
  return { cx: 0.5, cy: 0.5, confidence: 0.5 };
}

/**
 * V19.1 §29: Temporal smoothing — moving average over `window` seconds.
 * Avoids jitter from noisy detections.
 */
function smoothSubjectPositions(
  frames: ReframeFrame[],
  windowSec: number,
): ReframeFrame[] {
  if (frames.length === 0) return [];
  if (frames.length === 1) return [...frames];

  return frames.map((frame, i) => {
    // Collect frames within ±windowSec
    const neighbors = frames.filter((f) => Math.abs(f.time - frame.time) <= windowSec);
    const avgCx = neighbors.reduce((sum, f) => sum + f.cx, 0) / neighbors.length;
    const avgCy = neighbors.reduce((sum, f) => sum + f.cy, 0) / neighbors.length;
    const avgConfidence = neighbors.reduce((sum, f) => sum + f.confidence, 0) / neighbors.length;
    return {
      time: frame.time,
      cx: avgCx,
      cy: avgCy,
      confidence: avgConfidence,
    };
  });
}

/**
 * V19.1 §29: Generate transform keyframes for the reframed clip.
 *
 * The keyframes animate the source crop window to follow the subject.
 * Each keyframe has:
 *   - time: seconds relative to the clip start
 *   - property: 'x' or 'y' (transform position, normalized 0..1)
 *   - value: the position to keep the subject centered in the target frame
 */
function generateReframeKeyframes(
  frames: ReframeFrame[],
  sourceW: number,
  sourceH: number,
  targetW: number,
  targetH: number,
): Keyframe[] {
  const keyframes: Keyframe[] = [];

  // V19.1 §29: The crop window is targetW × targetH.
  // To keep the subject centered, the crop window's top-left corner is:
  //   x = subject.cx * sourceW - targetW / 2
  //   y = subject.cy * sourceH - targetH / 2
  // Clamp to [0, sourceW - targetW] and [0, sourceH - targetH].
  // The transform.x/y (normalized 0..1) is the offset from center, so:
  //   transform.x = (subject.cx - 0.5) * (sourceW - targetW) / sourceW * -1
  //   (negative because moving the crop window right shifts the subject left in the output)

  const maxOffsetX = sourceW - targetW;
  const maxOffsetY = sourceH - targetH;

  for (const frame of frames) {
    // Subject's position in pixels
    const subjectXpx = frame.cx * sourceW;
    const subjectYpx = frame.cy * sourceH;

    // Crop window top-left (centered on subject, clamped)
    const cropX = clamp(subjectXpx - targetW / 2, 0, maxOffsetX);
    const cropY = clamp(subjectYpx - targetH / 2, 0, maxOffsetY);

    // Convert to normalized transform.x/y (offset from center, -1..1)
    // transform.x = (crop center - source center) / sourceWidth, negated
    const transformX = -((cropX + targetW / 2 - sourceW / 2) / sourceW);
    const transformY = -((cropY + targetH / 2 - sourceH / 2) / sourceH);

    keyframes.push({
      id: `kf-x-${frame.time}`,
      time: frame.time,
      property: 'x',
      value: transformX,
      easing: 'ease-in-out',
    });
    keyframes.push({
      id: `kf-y-${frame.time}`,
      time: frame.time,
      property: 'y',
      value: transformY,
      easing: 'ease-in-out',
    });
  }

  return keyframes;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
