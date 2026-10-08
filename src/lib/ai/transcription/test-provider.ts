// VidiaForge — Test Transcription Provider
//
// V17.1 §55: Deterministic test provider used by the worker integration test.
// Returns a fixed, deterministic transcript so Worker B can actually COMPLETE
// the transcription pipeline and the test can validate the output.
//
// SAFETY: This provider is ONLY available when NODE_ENV === 'test'. In any
// other mode it throws — it must NEVER serve production traffic.
//
// The output is intentionally tiny (1 segment, 1 cue) so the test runs fast
// and the assertion is stable.

import type { TranscriptionProvider, Transcript, TranscriptionOptions } from './types';

export class TestTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'test' as const;

  async transcribe(
    _audioPath: string,
    _options?: TranscriptionOptions
  ): Promise<Transcript> {
    // V17.1 §54: SAFETY — fail closed outside of test mode.
    if (process.env.NODE_ENV !== 'test') {
      throw new Error(
        'TEST_PROVIDER_NOT_AVAILABLE: TestTranscriptionProvider is only ' +
        'available in NODE_ENV=test. Production must use a real provider.'
      );
    }

    // V17.1 §55: Deterministic output — the test asserts this exact shape.
    return {
      language: _options?.language || 'en',
      segments: [
        {
          id: 'seg_1',
          start: 0,
          end: 2.5,
          text: 'This is a deterministic test transcript for VidiaForge v17.1 certification.',
          speaker: 'speaker_1',
        },
      ],
      words: [
        { text: 'This', start: 0, end: 0.2 },
        { text: 'is', start: 0.2, end: 0.35 },
        { text: 'a', start: 0.35, end: 0.45 },
        { text: 'deterministic', start: 0.45, end: 1.0 },
        { text: 'test', start: 1.0, end: 1.2 },
        { text: 'transcript', start: 1.2, end: 1.7 },
        { text: 'for', start: 1.7, end: 1.85 },
        { text: 'VidiaForge', start: 1.85, end: 2.2 },
        { text: 'v17.1', start: 2.2, end: 2.4 },
        { text: 'certification.', start: 2.4, end: 2.5 },
      ],
    };
  }
}
