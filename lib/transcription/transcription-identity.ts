// VidiaForge — Transcription Identity (V9.1 §24-26)
//
// Deterministic SHA-256 identity for transcription results.
// Replaces the old count-based matching (cues.length === existingCues.length)
// which could incorrectly match two completely different transcripts with the
// same number of cues.
//
// The identity includes:
//   projectId
//   assetId
//   provider
//   providerModel
//   language
//   transcript content (canonical JSON of cues)
//
// Two requests with the same identity → same transcript → no duplicate captions.
// Any change to any field → different identity → new caption application.

import { createHash } from 'crypto';

interface TranscriptionIdentityInput {
  projectId: string;
  assetId: string;
  provider: string;
  providerModel: string;
  language: string;
  /** Array of cue objects with { start, end, text } */
  cues: Array<{ start: number; end: number; text: string }>;
}

/**
 * Produce a canonical JSON string from an arbitrary object by sorting keys
 * recursively. This ensures that two objects with the same content but
 * different property order produce the same string.
 */
function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalStringify).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify((value as Record<string, unknown>)[k])).join(',') + '}';
}

/**
 * Compute a deterministic transcription identity.
 *
 * Two requests representing the same transcription result produce the same identity.
 * Any change to project, asset, provider, model, language, or transcript content
 * produces a different identity.
 */
export function computeTranscriptionIdentity(input: TranscriptionIdentityInput): string {
  // Canonicalize the cues array — only include start, end, text (stable fields)
  const canonicalCues = input.cues.map((c) => ({
    start: Math.round(c.start * 1000) / 1000, // normalize to ms precision
    end: Math.round(c.end * 1000) / 1000,
    text: c.text,
  }));

  const canonical = canonicalStringify({
    projectId: input.projectId,
    assetId: input.assetId,
    provider: input.provider,
    providerModel: input.providerModel,
    language: input.language,
    cues: canonicalCues,
  });

  return createHash('sha256').update(canonical).digest('hex');
}
