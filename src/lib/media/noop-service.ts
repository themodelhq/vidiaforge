// VidiaForge — NoopMediaProcessor
// The HONEST fallback. Throws MediaProcessorUnavailableError on every method.
// Used when no MediaProcessor is available (FFmpeg not installed).
// NEVER silently succeeds.

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

const MSG =
  'Media processing is unavailable: FFmpeg/ffprobe not installed. ' +
  'Install ffmpeg (https://ffmpeg.org/download.html), set FFmpeg in PATH, ' +
  'or run the worker service (mini-services/worker) which bundles ffmpeg-static.';

export class NoopMediaProcessor implements MediaProcessor {
  readonly name = 'noop';
  probe(_filePath: string): Promise<MediaMetadata> {
    return Promise.reject(new MediaProcessorUnavailableError(MSG));
  }
  generateThumbnail(_input: GenerateThumbnailInput): Promise<GenerateResult> {
    return Promise.reject(new MediaProcessorUnavailableError(MSG));
  }
  generateWaveform(_input: GenerateWaveformInput): Promise<WaveformResult> {
    return Promise.reject(new MediaProcessorUnavailableError(MSG));
  }
  generateProxy(_input: GenerateProxyInput): Promise<GenerateResult> {
    return Promise.reject(new MediaProcessorUnavailableError(MSG));
  }
  extractAudio(_input: ExtractAudioInput): Promise<GenerateResult> {
    return Promise.reject(new MediaProcessorUnavailableError(MSG));
  }
}
