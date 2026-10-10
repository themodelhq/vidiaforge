// VidiaForge — Transcription provider interface + types.

export interface TranscriptWord {
  text: string;
  start: number; // seconds
  end: number;
  confidence?: number;
  speaker?: string;
}

export interface TranscriptSegment {
  id: string;
  start: number; // seconds
  end: number;
  text: string;
  speaker?: string;
  words?: TranscriptWord[];
}

export interface TranscriptSpeaker {
  id: string;
  label: string;
}

export interface Transcript {
  language: string;
  segments: TranscriptSegment[];
  words: TranscriptWord[];
  speakers?: TranscriptSpeaker[];
}

export interface TranscriptionOptions {
  language?: string; // BCP-47 hint, e.g. "en"
  /** Enable speaker diarization if supported. */
  diarize?: boolean;
  /** Enable word-level timestamps. */
  wordTimestamps?: boolean;
  /** Maximum segments to return (provider may truncate). */
  maxSegments?: number;
  /** Optional prompt to bias the model's vocabulary. */
  prompt?: string;
}

export class TranscriptionUnavailableError extends Error {
  readonly code = 'TRANSCRIPTION_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptionUnavailableError';
  }
}

export interface TranscriptionProvider {
  readonly name: string;
  transcribe(audioPath: string, options?: TranscriptionOptions): Promise<Transcript>;
}
