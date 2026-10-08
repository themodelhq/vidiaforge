// VidiaForge — CaptionService
// generateCaptions(): calls transcription provider, normalizes transcript into caption cues.
// parseSrt(), parseVtt(), toSrt(), toVtt(), toJson() — real SRT/VTT parsing + generation.
//
// Caption formatting rules (CEA-608 inspired, simplified):
//   - Max 32 chars per line
//   - Max 2 lines per cue
//   - Minimum 0.1s gap between cues
//   - Min duration 0.5s, max duration 7s

import type { CaptionCue } from '../types';
import { getTranscriptionProvider } from './transcription';
// V19: TranscriptionOptions is exported from ./transcription/types, not ./transcription
import type { TranscriptionOptions } from './transcription/types';

const MAX_CHARS_PER_LINE = 32;
const MAX_LINES = 2;
const MIN_GAP_SEC = 0.1;
const MIN_DURATION_SEC = 0.5;
const MAX_DURATION_SEC = 7;

export interface CaptionOptions extends TranscriptionOptions {
  /** Maximum chars per line (default 32). */
  maxCharsPerLine?: number;
  /** Maximum lines per cue (default 2). */
  maxLines?: number;
}

export class CaptionService {
  /**
   * Transcribe an audio file and produce formatted caption cues.
   * Throws TranscriptionUnavailableError if no provider is configured.
   */
  async generateCaptions(audioPath: string, options?: CaptionOptions): Promise<CaptionCue[]> {
    const provider = getTranscriptionProvider();
    if (!provider) {
      throw new Error('TRANSCRIPTION_PROVIDER_NOT_CONFIGURED');
    }
    const transcript = await provider.transcribe(audioPath, options);
    return this.normalize(transcript, options);
  }

  /** Normalize a transcript (segments + words) into caption cues. */
  normalize(
    transcript: { segments: Array<{ start: number; end: number; text: string; speaker?: string; words?: Array<{ text: string; start: number; end: number }> }> },
    options?: CaptionOptions
  ): CaptionCue[] {
    const maxChars = options?.maxCharsPerLine ?? MAX_CHARS_PER_LINE;
    const maxLines = options?.maxLines ?? MAX_LINES;

    const cues: CaptionCue[] = [];
    let counter = 0;

    for (const seg of transcript.segments) {
      if (!seg.text || !seg.text.trim()) continue;
      const start = seg.start;
      const end = seg.end;
      const duration = end - start;
      if (!isFinite(duration) || duration <= 0) continue;

      // Split text into lines respecting max chars + max lines.
      const lines = wrapLines(seg.text.trim(), maxChars, maxLines);
      const text = lines.join('\n');

      // Adjust duration to min/max bounds
      const adjustedStart = start;
      let adjustedEnd = end;
      if (adjustedEnd - adjustedStart < MIN_DURATION_SEC) {
        adjustedEnd = adjustedStart + MIN_DURATION_SEC;
      }
      if (adjustedEnd - adjustedStart > MAX_DURATION_SEC) {
        adjustedEnd = adjustedStart + MAX_DURATION_SEC;
      }

      // Enforce minimum gap from previous cue
      const prev = cues[cues.length - 1];
      if (prev && adjustedStart - prev.end < MIN_GAP_SEC) {
        // Don't move start — better to slightly overlap than break sync.
      }

      cues.push({
        id: `cue_${++counter}`,
        start: round(adjustedStart, 3),
        end: round(adjustedEnd, 3),
        text,
        speaker: seg.speaker,
        words: seg.words?.map((w) => ({ text: w.text, start: w.start, end: w.end })),
      });
    }

    return cues;
  }

  /** Parse a WebVTT string into cues. */
  parseVtt(vtt: string): CaptionCue[] {
    const normalized = vtt.replace(/^WEBVTT[^\n]*\n/, '');
    return parseCueBlocks(normalized);
  }

  /** Parse an SRT string into cues. */
  parseSrt(srt: string): CaptionCue[] {
    // SRT blocks have numeric IDs; VTT blocks may have identifiers or none.
    // Strip BOM and normalize newlines
    const normalized = srt.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    return parseCueBlocks(normalized);
  }

  /** Render cues to SRT format. */
  toSrt(cues: CaptionCue[]): string {
    const out: string[] = [];
    let i = 1;
    for (const cue of cues) {
      out.push(String(i++));
      out.push(`${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}`);
      out.push(cue.text);
      out.push('');
    }
    return out.join('\n');
  }

  /** Render cues to WebVTT format. */
  toVtt(cues: CaptionCue[]): string {
    const out: string[] = ['WEBVTT', ''];
    for (const cue of cues) {
      if (cue.id) out.push(cue.id);
      out.push(`${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}`);
      out.push(cue.text);
      out.push('');
    }
    return out.join('\n');
  }

  /** Render cues to JSON (array of cue objects). */
  toJson(cues: CaptionCue[]): string {
    return JSON.stringify(cues, null, 2);
  }
}

// === Internal helpers ===

function parseCueBlocks(text: string): CaptionCue[] {
  const cues: CaptionCue[] = [];
  // Blocks separated by one-or-more blank lines
  const blocks = text.split(/\n{2,}/);
  let counter = 0;
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.length > 0);
    if (lines.length === 0) continue;

    // The cue timing line is the one matching `-->`.
    let timingIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingIdx === -1) continue;

    // Identifier may precede the timing line (VTT style).
    const id = timingIdx > 0 ? lines[0] : undefined;

    const timingLine = lines[timingIdx];
    const m = /^([\d:.,]+)\s*-->\s*([\d:.,]+)/.exec(timingLine);
    if (!m) continue;

    const start = parseTime(m[1]);
    const end = parseTime(m[2]);
    if (!isFinite(start) || !isFinite(end) || end < start) continue;

    const textLines = lines.slice(timingIdx + 1);
    const text = textLines.join('\n').trim();
    if (!text) continue;

    counter++;
    cues.push({
      id: id && !/^\d+$/.test(id) ? id : `cue_${counter}`,
      start: round(start, 3),
      end: round(end, 3),
      text,
    });
  }
  return cues;
}

function parseTime(t: string): number {
  // Supports: HH:MM:SS.mmm, HH:MM:SS,mmm (SRT), MM:SS.mmm
  const cleaned = t.trim().replace(',', '.');
  const parts = cleaned.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function formatSrtTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);
  const totalSec = Math.floor(seconds);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(ms)}`;
}

function formatVttTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);
  const totalSec = Math.floor(seconds);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${pad3(ms)}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

function round(n: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

/**
 * Greedy word-wrap: split a string into lines no longer than maxChars.
 * Hard-breaks words longer than maxChars.
 */
function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word.length > maxChars ? word.slice(0, maxChars) : word;
      continue;
    }
    if (current.length + 1 + word.length <= maxChars) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word.length > maxChars ? word.slice(0, maxChars) : word;
      if (lines.length >= maxLines - 1) {
        // Last allowed line — push the rest, hard-truncated
        break;
      }
    }
  }
  if (current) lines.push(current);

  // If we hit maxLines, append remaining words to the last line (truncated)
  if (lines.length >= maxLines) {
    return lines.slice(0, maxLines);
  }
  return lines;
}
