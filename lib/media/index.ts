// VidiaForge — Media processor factory.
// Returns a memoized FFmpegMediaProcessor instance.
// The factory itself never throws — methods do — so callers can gracefully
// handle missing FFmpeg without try/catch around the factory.

import { FFmpegMediaProcessor } from './ffmpeg-service';
import { NoopMediaProcessor } from './noop-service';
import type { MediaProcessor } from './types';

let instance: MediaProcessor | null = null;

export function getMediaProcessor(): MediaProcessor {
  if (instance) return instance;
  // Always prefer the real FFmpeg processor. The methods feature-detect and throw
  // MediaProcessorUnavailableError if binaries are missing.
  instance = new FFmpegMediaProcessor();
  return instance;
}

/** Returns the NoopMediaProcessor — used in tests / when caller explicitly wants the stub. */
export function getNoopMediaProcessor(): MediaProcessor {
  return new NoopMediaProcessor();
}

export type {
  MediaProcessor,
  MediaMetadata,
  GenerateThumbnailInput,
  GenerateWaveformInput,
  GenerateProxyInput,
  ExtractAudioInput,
  GenerateResult,
  WaveformResult,
} from './types';
export { MediaProcessorUnavailableError } from './types';
export { FFmpegMediaProcessor } from './ffmpeg-service';
export { NoopMediaProcessor } from './noop-service';
