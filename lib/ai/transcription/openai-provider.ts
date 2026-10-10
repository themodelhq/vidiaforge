// VidiaForge — OpenAI Whisper transcription provider
// Uses fetch() to https://api.openai.com/v1/audio/transcriptions with whisper-1.
// Requires TRANSCRIPTION_API_KEY env var. Feature-detect: throws clear error if missing.

import { readFile } from 'fs/promises';
import path from 'path';
import type { TranscriptionProvider, Transcript, TranscriptionOptions } from './types';
import { TranscriptionUnavailableError } from './types';

export class OpenAITranscriptionProvider implements TranscriptionProvider {
  readonly name = 'openai';

  private apiKey(): string {
    const key = process.env.TRANSCRIPTION_API_KEY;
    if (!key) {
      throw new TranscriptionUnavailableError(
        'TRANSCRIPTION_API_KEY env var is required for the OpenAI provider. Set it in .env or set TRANSCRIPTION_PROVIDER=local.'
      );
    }
    return key;
  }

  async transcribe(audioPath: string, options?: TranscriptionOptions): Promise<Transcript> {
    const apiKey = this.apiKey();
    let buf: Buffer;
    try {
      buf = await readFile(audioPath);
    } catch (err) {
      throw new TranscriptionUnavailableError(
        `Failed to read audio file ${audioPath}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const filename = path.basename(audioPath);
    const form = new FormData();
    const blob = new Blob([new Uint8Array(buf)], { type: guessMime(filename) });
    form.append('file', blob, filename);
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');
    if (options?.language) form.append('language', options.language);
    if (options?.prompt) form.append('prompt', options.prompt);
    // Whisper supports word timestamps via timestamp_granularities[]=word
    if (options?.wordTimestamps !== false) {
      form.append('timestamp_granularities[]', 'word');
      form.append('timestamp_granularities[]', 'segment');
    }

    let resp: Response;
    try {
      resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
    } catch (err) {
      throw new TranscriptionUnavailableError(
        `OpenAI transcription request failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new TranscriptionUnavailableError(
        `OpenAI transcription failed (HTTP ${resp.status}): ${text.slice(0, 500)}`
      );
    }

    const data = (await resp.json()) as any;
    return normalizeOpenAIResponse(data, options);
  }
}

function normalizeOpenAIResponse(data: any, options?: TranscriptionOptions): Transcript {
  const segments = Array.isArray(data.segments) ? data.segments.map((s: any, i: number) => ({
    id: String(s.id ?? i),
    start: Number(s.start ?? 0),
    end: Number(s.end ?? 0),
    text: String(s.text ?? '').trim(),
    words: Array.isArray(s.words)
      ? s.words.map((w: any, j: number) => ({
          text: String(w.word ?? w.text ?? ''),
          start: Number(w.start ?? 0),
          end: Number(w.end ?? 0),
          confidence: typeof w.confidence === 'number' ? w.confidence : undefined,
        }))
      : undefined,
  })) : [];

  const words = Array.isArray(data.words) ? data.words.map((w: any) => ({
    text: String(w.word ?? w.text ?? ''),
    start: Number(w.start ?? 0),
    end: Number(w.end ?? 0),
    confidence: typeof w.confidence === 'number' ? w.confidence : undefined,
  })) : [];

  const truncated = options?.maxSegments && segments.length > options.maxSegments
    ? segments.slice(0, options.maxSegments) : segments;

  return {
    language: String(data.language ?? 'unknown'),
    segments: truncated,
    words,
  };
}

function guessMime(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.webm': 'audio/webm',
  };
  return map[ext] || 'application/octet-stream';
}
