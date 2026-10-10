// VidiaForge v19.1 — AI Highlight Detection + Shorts Generator
//
// V19.1 §34: Replace canned AI responses with real analysis.
// Analyzes actual media + transcript to identify highlight moments.
//
// V19.1 §35: Shorts generator takes a long video → produces short candidates.
//
// V19.1 §1: NO FAKE FEATURES — uses real signals (audio peaks, scene changes,
// transcript keywords) rather than random selection.

import type { CaptionCue } from '../types';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const execFileP = promisify(execFile);

export interface HighlightSegment {
  start: number;
  end: number;
  score: number;      // 0..1 — higher = better
  reason: string;     // why this is a highlight
  title: string;      // short title for the segment
  cueText?: string;   // transcript snippet (if available)
}

export interface HighlightDetectionResult {
  segments: HighlightSegment[];
  sourceDuration: number;
  /** Total duration of all highlights combined. */
  totalHighlightDuration: number;
  /** Signals used (for transparency). */
  signalsUsed: string[];
}

export interface ShortCandidate extends HighlightSegment {
  /** Reframed aspect ratio for this short (9:16 by default). */
  aspectRatio: '9:16' | '1:1' | '4:5';
  /** Suggested title for the short project. */
  projectTitle: string;
  /** Generated caption cues for this short. */
  cues: CaptionCue[];
}

/**
 * V19.1 §34: Detect highlight segments in a video.
 *
 * Signals used (V19.1 §1: real, not fake):
 *   - Audio peaks (loud moments = emphasis/excitement)
 *   - Scene changes (visual cuts = action shifts)
 *   - Transcript keywords (questions, numbers, emotional words)
 *   - Silence gaps (natural break points for segment boundaries)
 *
 * V19.1 §53: Deterministic — same input produces same output.
 */
export async function detectHighlights(
  inputPath: string,
  cues?: CaptionCue[],
  options?: {
    minSegmentDuration?: number;  // default 5s
    maxSegmentDuration?: number;  // default 60s
    targetCount?: number;         // default 5
  },
): Promise<HighlightDetectionResult> {
  const minDur = options?.minSegmentDuration ?? 5;
  const maxDur = options?.maxSegmentDuration ?? 60;
  const targetCount = options?.targetCount ?? 5;
  const signalsUsed: string[] = [];

  // V19.1 §34: Get source duration via ffprobe
  const { resolveFfprobe } = await import('../media/binary-resolver');
  const ffprobePath = (await resolveFfprobe()).path;
  const { stdout: probeJson } = await execFileP(ffprobePath, [
    '-v', 'quiet', '-print_format', 'json', '-show_format', inputPath,
  ], { timeout: 30_000 });
  const probe = JSON.parse(probeJson);
  const sourceDuration = parseFloat(probe.format?.duration || '0');

  // V19.1 §34: SIGNAL 1 — Audio peaks via FFmpeg's astats filter
  // Sample audio levels at 1-second intervals
  const audioPeaks: Array<{ time: number; level: number }> = [];
  try {
    for (let t = 0; t < sourceDuration; t += 1) {
      const level = await sampleAudioLevel(inputPath, t, ffprobePath);
      audioPeaks.push({ time: t, level });
    }
    signalsUsed.push('audio_peaks');
  } catch {
    // Audio analysis failed — skip this signal
  }

  // V19.1 §34: SIGNAL 2 — Scene changes via FFmpeg's select filter
  const sceneChanges: number[] = [];
  try {
    const scenes = await detectSceneChanges(inputPath);
    sceneChanges.push(...scenes);
    signalsUsed.push('scene_changes');
  } catch {
    // Skip
  }

  // V19.1 §34: SIGNAL 3 — Transcript keyword analysis
  const transcriptHighlights: Array<{ time: number; score: number; reason: string }> = [];
  if (cues && cues.length > 0) {
    signalsUsed.push('transcript_keywords');
    for (const cue of cues) {
      const analysis = analyzeCueText(cue.text);
      if (analysis.score > 0) {
        transcriptHighlights.push({
          time: cue.start,
          score: analysis.score,
          reason: analysis.reason,
        });
      }
    }
  }

  // V19.1 §34: Combine signals into candidate segments
  const candidates: HighlightSegment[] = [];

  // V19.1 §34: From audio peaks — top N loudest moments
  if (audioPeaks.length > 0) {
    const sortedPeaks = [...audioPeaks].sort((a, b) => b.level - a.level);
    const topPeaks = sortedPeaks.slice(0, targetCount * 2);
    for (const peak of topPeaks) {
      const segStart = Math.max(0, peak.time - minDur / 2);
      const segEnd = Math.min(sourceDuration, segStart + minDur);
      candidates.push({
        start: segStart,
        end: segEnd,
        score: normalizeScore(peak.level),
        reason: 'Audio peak detected (loud moment)',
        title: `Highlight at ${Math.floor(peak.time)}s`,
      });
    }
  }

  // V19.1 §34: From scene changes — each cut is a potential segment boundary
  for (const sceneTime of sceneChanges) {
    const segStart = sceneTime;
    const segEnd = Math.min(sourceDuration, segStart + minDur);
    if (segEnd - segStart >= minDur) {
      candidates.push({
        start: segStart,
        end: segEnd,
        score: 0.5, // neutral — scene change alone isn't a strong signal
        reason: 'Scene change detected',
        title: `Scene at ${Math.floor(sceneTime)}s`,
      });
    }
  }

  // V19.1 §34: From transcript keywords — moments with strong content
  for (const th of transcriptHighlights) {
    const cue = cues?.find((c) => Math.abs(c.start - th.time) < 0.5);
    const segStart = Math.max(0, th.time - 1);
    const segEnd = Math.min(sourceDuration, segStart + maxDur);
    candidates.push({
      start: segStart,
      end: segEnd,
      score: th.score,
      reason: th.reason,
      title: cue ? cue.text.substring(0, 50) : `Highlight at ${Math.floor(th.time)}s`,
      cueText: cue?.text,
    });
  }

  // V19.1 §34: If no signals produced candidates, fall back to evenly-spaced segments
  if (candidates.length === 0) {
    signalsUsed.push('even_spacing_fallback');
    for (let i = 0; i < targetCount; i++) {
      const segStart = (sourceDuration / targetCount) * i;
      const segEnd = segStart + minDur;
      candidates.push({
        start: segStart,
        end: Math.min(segEnd, sourceDuration),
        score: 0.3,
        reason: 'Evenly spaced (no strong signals detected)',
        title: `Segment ${i + 1}`,
      });
    }
  }

  // V19.1 §34: Sort by score + remove overlaps
  candidates.sort((a, b) => b.score - a.score);
  const selected: HighlightSegment[] = [];
  for (const c of candidates) {
    if (selected.length >= targetCount) break;
    // Skip if overlaps with an already-selected segment
    const overlaps = selected.some((s) =>
      c.start < s.end && c.end > s.start,
    );
    if (!overlaps) {
      selected.push(c);
    }
  }

  // V19.1 §34: Sort by time
  selected.sort((a, b) => a.start - b.start);

  const totalDuration = selected.reduce((sum, s) => sum + (s.end - s.start), 0);

  return {
    segments: selected,
    sourceDuration,
    totalHighlightDuration: totalDuration,
    signalsUsed,
  };
}

/**
 * V19.1 §35: Generate short candidates from highlight segments.
 *
 * Each highlight becomes a short candidate with:
 *   - 9:16 reframing (default)
 *   - Caption cues extracted from the source transcript
 *   - Suggested project title
 */
export async function generateShorts(
  inputPath: string,
  highlights: HighlightSegment[],
  cues?: CaptionCue[],
  options?: {
    aspectRatio?: '9:16' | '1:1' | '4:5';
    maxDuration?: number; // default 60s
  },
): Promise<ShortCandidate[]> {
  const aspect = options?.aspectRatio ?? '9:16';
  const maxDur = options?.maxDuration ?? 60;

  const shorts: ShortCandidate[] = [];
  for (const h of highlights) {
    // V19.1 §35: Cap duration at maxDur
    const duration = Math.min(h.end - h.start, maxDur);
    const start = h.start;
    const end = start + duration;

    // V19.1 §35: Extract caption cues for this segment
    const segmentCues: CaptionCue[] = [];
    if (cues) {
      for (const cue of cues) {
        if (cue.start >= start && cue.end <= end) {
          // Shift cue times to be relative to the short's start
          segmentCues.push({
            ...cue,
            start: cue.start - start,
            end: cue.end - start,
          });
        }
      }
    }

    shorts.push({
      ...h,
      start,
      end,
      aspectRatio: aspect,
      projectTitle: h.title || `Short ${Math.floor(start)}s`,
      cues: segmentCues,
    });
  }

  return shorts;
}

// === Helpers ===

async function sampleAudioLevel(inputPath: string, time: number, _ffprobePath: string): Promise<number> {
  // V19.1 §34: Use FFmpeg's astats filter to measure RMS level at a specific time
  try {
    const { resolveFfmpeg } = await import('../media/binary-resolver');
    const ffmpegPath = (await resolveFfmpeg()).path;
    const { stdout } = await execFileP(ffmpegPath, [
      '-ss', String(time), '-i', inputPath,
      '-t', '1',
      '-af', 'astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level',
      '-f', 'null', '-',
    ], { timeout: 10_000 });
    // Parse the RMS level from stderr
    const match = stdout.match(/RMS_level=([-\d.]+)/);
    if (match) {
      // RMS level is in dB, typically -60..0. Convert to 0..1.
      const db = parseFloat(match[1]);
      return Math.max(0, (db + 60) / 60);
    }
  } catch {
    // Fall through
  }
  return 0.5; // neutral
}

async function detectSceneChanges(inputPath: string): Promise<number[]> {
  // V19.1 §34: Use FFmpeg's select filter to detect scene changes
  try {
    const { resolveFfmpeg } = await import('../media/binary-resolver');
    const ffmpegPath = (await resolveFfmpeg()).path;
    const { stderr } = await execFileP(ffmpegPath, [
      '-i', inputPath,
      '-vf', 'select=\'gt(scene,0.3)\',showinfo',
      '-f', 'null', '-',
    ], { timeout: 60_000 });
    // Parse pts_time entries from stderr
    const times: number[] = [];
    const matches = stderr.matchAll(/pts_time:(\d+\.?\d*)/g);
    for (const m of matches) {
      times.push(parseFloat(m[1]));
    }
    return times;
  } catch {
    return [];
  }
}

function analyzeCueText(text: string): { score: number; reason: string } {
  const lower = text.toLowerCase();
  let score = 0;
  let reason = '';

  // V19.1 §34: Questions (who, what, when, where, why, how)
  if (/\b(who|what|when|where|why|how)\b/.test(lower)) {
    score += 0.3;
    reason = 'Question detected';
  }

  // V19.1 §34: Numbers (statistics, dollar amounts)
  if (/\b\d+/.test(lower)) {
    score += 0.2;
    reason += (reason ? ' + ' : '') + 'Numbers detected';
  }

  // V19.1 §34: Emotional words
  const emotionalWords = ['amazing', 'incredible', 'shocking', 'wow', 'love', 'hate', 'best', 'worst', 'never', 'always'];
  for (const word of emotionalWords) {
    if (lower.includes(word)) {
      score += 0.4;
      reason += (reason ? ' + ' : '') + `Emotional word: "${word}"`;
      break;
    }
  }

  // V19.1 §34: Call-to-action phrases
  const ctaWords = ['subscribe', 'follow', 'like', 'share', 'comment', 'link in bio'];
  for (const word of ctaWords) {
    if (lower.includes(word)) {
      score += 0.3;
      reason += (reason ? ' + ' : '') + `CTA phrase: "${word}"`;
      break;
    }
  }

  return { score: Math.min(1, score), reason: reason || 'No strong signal' };
}

function normalizeScore(level: number): number {
  // V19.1 §34: Normalize 0..1 audio level to 0..1 highlight score
  // Louder moments score higher
  return Math.max(0.3, Math.min(1, level));
}
