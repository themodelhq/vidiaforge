// VidiaForge — Deepgram transcription provider
// Uses fetch() to https://api.deepgram.com/v1/listen with multichannel/utterances/diarize.
// Requires TRANSCRIPTION_API_KEY env var.

import { readFile } from 'fs/promises';
import path from 'path';
import type { TranscriptionProvider, Transcript, TranscriptionOptions } from './types';
import { TranscriptionUnavailableError } from './types';

export class DeepgramTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'deepgram';

  private apiKey(): string {
    const key = process.env.TRANSCRIPTION_API_KEY;
    if (!key) {
      throw new TranscriptionUnavailableError(
        'TRANSCRIPTION_API_KEY env var is required for the Deepgram provider. Set it in .env or set TRANSCRIPTION_PROVIDER=local.'
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

    const params = new URLSearchParams();
    params.set('model', 'nova-2');
    params.set('smart_format', 'true');
    params.set('utterances', 'true');
    if (options?.diarize !== false) params.set('diarize', 'true');
    if (options?.wordTimestamps !== false) params.set('multichannel', 'false');
    if (options?.language) params.set('language', options.language);
    if (options?.prompt) params.set('keywords', options.prompt.slice(0, 200));

    const mime = guessMime(audioPath);
    let resp: Response;
    try {
      resp = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': mime,
        },
        // V19: Buffer → Uint8Array for fetch BodyInit type compatibility.
        body: new Uint8Array(buf),
      });
    } catch (err) {
      throw new TranscriptionUnavailableError(
        `Deepgram transcription request failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new TranscriptionUnavailableError(
        `Deepgram transcription failed (HTTP ${resp.status}): ${text.slice(0, 500)}`
      );
    }

    const data = (await resp.json()) as any;
    return normalizeDeepgramResponse(data, options);
  }
}

function normalizeDeepgramResponse(data: any, options?: TranscriptionOptions): Transcript {
  // Deepgram returns results.channels[].alternatives[0].words + utterances[]
  const channel = data?.results?.channels?.[0];
  const alt = channel?.alternatives?.[0];
  const utterances = Array.isArray(data?.results?.utterances) ? data.results.utterances : [];

  const words = Array.isArray(alt?.words)
    ? alt.words.map((w: any) => ({
        text: String(w.word ?? ''),
        start: Number(w.start ?? 0),
        end: Number(w.end ?? 0),
        confidence: typeof w.confidence === 'number' ? w.confidence : undefined,
        speaker: typeof w.speaker === 'number' ? `Speaker ${w.speaker + 1}` : undefined,
      }))
    : [];

  const segments = utterances.map((u: any, i: number) => ({
    id: String(u.id ?? i),
    start: Number(u.start ?? 0),
    end: Number(u.end ?? 0),
    text: String(u.transcript ?? '').trim(),
    speaker: typeof u.speaker === 'number' ? `Speaker ${u.speaker + 1}` : undefined,
    words: Array.isArray(u.words)
      ? u.words.map((w: any) => ({
          text: String(w.word ?? ''),
          start: Number(w.start ?? 0),
          end: Number(w.end ?? 0),
          confidence: typeof w.confidence === 'number' ? w.confidence : undefined,
        }))
      : undefined,
  }));

  const truncated = options?.maxSegments && segments.length > options.maxSegments
    ? segments.slice(0, options.maxSegments) : segments;

  const speakers = Array.isArray(data?.results?.channels?.[0]?.alternatives?.[0]?.words)
    ? Array.from(new Set(
        alt.words.map((w: any) => (typeof w.speaker === 'number' ? `Speaker ${w.speaker + 1}` : null)).filter(Boolean) as string[]
      )).map((label, i) => ({ id: `sp${i}`, label }))
    : undefined;

  // Detect language — Deepgram auto-detects; expose detected language if present.
  const language = data?.results?.channels?.[0]?.detected_language || options?.language || 'unknown';

  return {
    language,
    segments: truncated,
    words,
    speakers,
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
