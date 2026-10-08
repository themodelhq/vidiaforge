// VidiaForge — Supported AI jobs registry (S2)
//
// Single source of truth for which AI job kinds actually have a real processor
// implementation in this codebase. Used by API routes + worker dispatchers to
// reject unsupported kinds early with a clear `AI_JOB_NOT_IMPLEMENTED` error
// instead of silently queuing work that will never run.
//
// === Currently supported (have real processors) ===
//   - `transcribe`  → CaptionService → TranscriptionProvider (openai/deepgram/local-whisper)
//   - `translate`   → TranslationProvider (ZAI / OpenAI / Deepgram)
//   - `ai_edit`     → AICommandEngine (LLM-driven structured edit commands)
//
// === NOT YET IMPLEMENTED (must be rejected at the API layer) ===
//   - `highlight_detection`   (planned — needs shot-boundary detection + scene scoring)
//   - `audio_enhancement`     (planned — needs RNNoise / DEMUCS pipeline)
//   - `background_removal`    (planned — needs MediaPipe Selfie Segmentation or RVM)
//   - `auto_reframe`          (planned — needs subject-detection + smart-crop)
//
// When you IMPLEMENT a new processor, add its kind to SUPPORTED_AI_JOBS below.
// The API and worker will pick up the change automatically.

export const SUPPORTED_AI_JOBS = ['transcribe', 'translate', 'ai_edit'] as const;
export type SupportedAIJob = typeof SUPPORTED_AI_JOBS[number];

/**
 * Type guard — returns true if the given kind string maps to a real processor
 * implementation. Use this at the top of API handlers that enqueue AI jobs:
 *
 *   if (!isAIJobSupported(kind)) {
 *     return NextResponse.json(
 *       { error: `AI_JOB_NOT_IMPLEMENTED: ${kind} is not yet supported.`,
 *         code: ERROR_CODES.AI_JOB_NOT_IMPLEMENTED },
 *       { status: 501 }
 *     );
 *   }
 */
export function isAIJobSupported(kind: string): kind is SupportedAIJob {
  return (SUPPORTED_AI_JOBS as readonly string[]).includes(kind);
}

/**
 * Returns the list of unsupported kinds in the input. Useful for batch
 * validation of an LLM-generated command list (e.g. /api/ai/edit) where the
 * caller wants to filter out commands whose types don't have processors.
 */
export function filterUnsupportedKinds(kinds: string[]): string[] {
  return kinds.filter((k) => !isAIJobSupported(k));
}
