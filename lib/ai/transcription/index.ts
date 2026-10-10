// VidiaForge — Transcription provider factory.
// Reads TRANSCRIPTION_PROVIDER env var ("openai" | "deepgram").
//
// V5 fix: The previous factory defaulted to "local" which was a placeholder
// with no real implementation. This was misleading — it appeared to configure
// a provider when none was actually available. Now:
//   - If no provider is configured (or "local" is explicitly set), returns null
//   - Callers must check for null and respond with a clear error:
//     TRANSCRIPTION_PROVIDER_NOT_CONFIGURED
//   - Production must explicitly set TRANSCRIPTION_PROVIDER=openai|deepgram

import type { TranscriptionProvider } from './types';
import { OpenAITranscriptionProvider } from './openai-provider';
import { DeepgramTranscriptionProvider } from './deepgram-provider';
import { TestTranscriptionProvider } from './test-provider';

let instance: TranscriptionProvider | null = null;
let resolved = false;

export function getTranscriptionProvider(): TranscriptionProvider | null {
  if (resolved) return instance;
  resolved = true;

  const name = (process.env.TRANSCRIPTION_PROVIDER || '').toLowerCase().trim();
  switch (name) {
    case 'openai':
      instance = new OpenAITranscriptionProvider();
      return instance;
    case 'deepgram':
      instance = new DeepgramTranscriptionProvider();
      return instance;
    case 'test':
      // V17.1 §54-55: TestTranscriptionProvider is ONLY available in test mode.
      // Production deployments MUST NOT be able to use it — it returns a
      // deterministic dummy transcript. The provider itself also checks
      // NODE_ENV === 'test' and throws otherwise (defense in depth).
      if (process.env.NODE_ENV !== 'test') {
        console.error(
          '[transcription] TRANSCRIPTION_PROVIDER=test requires NODE_ENV=test. ' +
          'Refusing to instantiate test provider in ' +
          `'${process.env.NODE_ENV || 'development'}' mode.`
        );
        instance = null;
        return null;
      }
      instance = new TestTranscriptionProvider();
      return instance;
    case 'local':
      // V5: "local" is NOT a production-ready provider. It requires:
      // - Whisper model installation
      // - Model location configuration
      // - Startup validation
      // - Worker invocation
      // - Timeout/cancellation
      // None of these are implemented. Return null so callers respond with
      // TRANSCRIPTION_PROVIDER_NOT_CONFIGURED instead of silently accepting jobs.
      console.warn('[transcription] TRANSCRIPTION_PROVIDER=local is not implemented. Set TRANSCRIPTION_PROVIDER=openai or deepgram.');
      instance = null;
      return null;
    case '':
      // No provider configured — return null
      instance = null;
      return null;
    default:
      console.warn(`[transcription] Unknown TRANSCRIPTION_PROVIDER="${name}". Supported: openai, deepgram.`);
      instance = null;
      return null;
  }
}

export function isTranscriptionAvailable(): boolean {
  return getTranscriptionProvider() !== null;
}

export type { TranscriptionProvider };
