// VidiaForge — MediaProcessor interface + MediaMetadata type.
// Implemented by FFmpegMediaProcessor (real ffprobe/ffmpeg) and NoopMediaProcessor (honest fallback).

export interface MediaMetadata {
  duration: number; // seconds
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  pixelFormat?: string;
  audioChannels?: number;
  audioSampleRate?: number;
  videoBitrate?: number; // bps
  audioBitrate?: number; // bps
  mimeType: string;
  fileSize: number; // bytes
}

export interface GenerateThumbnailInput {
  /** Local file path of source media (already downloaded from object storage if needed). */
  inputPath: string;
  /** Time in seconds to grab the thumbnail frame. */
  atTime?: number;
  /** Target width; height auto-scales preserving aspect ratio. Default 640. */
  width?: number;
  /** Storage key to write the thumbnail to (e.g. "thumbnails/{assetId}.jpg"). */
  outputKey: string;
}

export interface GenerateWaveformInput {
  inputPath: string;
  /** Number of peaks to downsample to. Default 1000. */
  peaks?: number;
  outputKey: string;
}

export interface GenerateProxyInput {
  inputPath: string;
  /** Target max height. Default 720. */
  maxHeight?: number;
  outputKey: string;
}

export interface ExtractAudioInput {
  inputPath: string;
  outputKey: string;
}

export interface GenerateResult {
  path: string; // storage key (or local relative path)
  url: string; // accessible URL (signed for S3, /api for local)
}

export interface WaveformResult extends GenerateResult {
  peaks: number[];
}

/**
 * Thrown when no media processor is available (FFmpeg not installed).
 * Callers MUST catch this and surface a clear message — never silently no-op.
 */
export class MediaProcessorUnavailableError extends Error {
  readonly code = 'MEDIA_PROCESSOR_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'MediaProcessorUnavailableError';
  }
}

export interface MediaProcessor {
  /** Display name for health checks + logs. */
  readonly name: string;

  /** Probe media metadata via ffprobe. */
  probe(filePath: string): Promise<MediaMetadata>;

  /** Grab a single thumbnail frame and store it. */
  generateThumbnail(input: GenerateThumbnailInput): Promise<GenerateResult>;

  /** Decode audio to f32 PCM, downsample to peaks, store as JSON. */
  generateWaveform(input: GenerateWaveformInput): Promise<WaveformResult>;

  /** Transcode a low-res proxy for smoother timeline playback. */
  generateProxy(input: GenerateProxyInput): Promise<GenerateResult>;

  /** Extract audio track as WAV for transcription / waveform. */
  extractAudio(input: ExtractAudioInput): Promise<GenerateResult>;
}
