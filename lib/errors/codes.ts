// VidiaForge — Error code constants (S2)
//
// Single source of truth for error codes used across the backend. API routes
// return `{ error: { code, message, details } }` via ApiError.toJSON() so the
// frontend can switch on `code` and render a friendly message via
// `mapErrorCodeToUserMessage()` (see ./user-messages.ts).
//
// Conventions:
//   - Codes are UPPER_SNAKE_CASE strings, prefixed by domain (MEDIA_, STORAGE_, RENDER_, etc.).
//   - Codes are stable — never rename an existing code (the frontend depends on them).
//   - Add new codes here BEFORE using them anywhere else.
//   - HTTP status mapping lives on the ApiError class, NOT on the code itself,
//     because the same code can surface at different HTTP statuses in different
//     contexts (e.g. MEDIA_NOT_READY is 409 when the user retries too fast but
//     422 when they try to render with an unprocessed asset).

export const ERROR_CODES = {
  // Media asset lifecycle
  MEDIA_NOT_FOUND: 'MEDIA_NOT_FOUND',
  MEDIA_NOT_READY: 'MEDIA_NOT_READY',
  MEDIA_INGESTION_FAILED: 'MEDIA_INGESTION_FAILED',

  // Storage layer
  STORAGE_ERROR: 'STORAGE_ERROR',
  STORAGE_NOT_CONFIGURED: 'STORAGE_NOT_CONFIGURED',
  // V4-S1: upload pipeline verification failures — surfaced by /api/assets/finalize
  // when headObject() returns null or the actual size doesn't match the
  // UploadIntent.expectedSize. Stable string identifiers so the frontend can
  // branch on `code` + render a friendly toast (e.g. "Upload was interrupted
  // — please retry" for STORAGE_OBJECT_NOT_FOUND, "File size doesn't match
  // what was declared at upload" for UPLOAD_SIZE_MISMATCH).
  STORAGE_OBJECT_NOT_FOUND: 'STORAGE_OBJECT_NOT_FOUND',
  UPLOAD_SIZE_MISMATCH: 'UPLOAD_SIZE_MISMATCH',

  // Render pipeline
  RENDER_FAILED: 'RENDER_FAILED',
  RENDER_CANCELLED: 'RENDER_CANCELLED',
  RENDER_QUEUE_NOT_CONFIGURED: 'RENDER_QUEUE_NOT_CONFIGURED',

  // Transcription / translation providers
  TRANSCRIPTION_FAILED: 'TRANSCRIPTION_FAILED',
  TRANSCRIPTION_PROVIDER_NOT_CONFIGURED: 'TRANSCRIPTION_PROVIDER_NOT_CONFIGURED',
  TRANSLATION_PROVIDER_NOT_CONFIGURED: 'TRANSLATION_PROVIDER_NOT_CONFIGURED',

  // AI providers + job kinds
  AI_PROVIDER_ERROR: 'AI_PROVIDER_ERROR',
  AI_JOB_NOT_IMPLEMENTED: 'AI_JOB_NOT_IMPLEMENTED',

  // Project access
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  PROJECT_ACCESS_DENIED: 'PROJECT_ACCESS_DENIED',
  INVALID_PROJECT: 'INVALID_PROJECT',

  // Auth + generic
  UNAUTHORIZED: 'UNAUTHORIZED',
  RATE_LIMITED: 'RATE_LIMITED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];
