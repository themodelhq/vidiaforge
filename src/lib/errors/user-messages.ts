// VidiaForge — Backend error code → user-facing message mapping (S2)
//
// Frontend reads the `error.code` field from API responses and calls
// mapErrorCodeToUserMessage() to render a friendly, actionable message in a
// toast or inline banner.
//
// Rules:
//   - Every message tells the user (a) what happened and (b) what to do next.
//   - Never leak internals (file paths, stack traces, raw provider errors).
//   - If `code` isn't recognized, fall back to the caller-supplied `fallback`.
//   - Messages are short — toasts truncate after ~80 chars.

import { ERROR_CODES, type ErrorCode } from './codes';

const MESSAGES: Record<ErrorCode, string> = {
  [ERROR_CODES.MEDIA_NOT_FOUND]:
    'We could not find that media file. It may have been deleted. Try uploading it again.',
  [ERROR_CODES.MEDIA_NOT_READY]:
    'Your video is still being processed. Please wait until media ingestion completes before using it in a render.',
  [ERROR_CODES.MEDIA_INGESTION_FAILED]:
    'Media processing failed during upload. Check the file format and try again — if the problem persists, the worker may be missing FFmpeg.',
  [ERROR_CODES.STORAGE_ERROR]:
    'We could not reach the storage backend. If the problem persists, check that your object storage credentials are valid.',
  [ERROR_CODES.STORAGE_NOT_CONFIGURED]:
    'Storage is not configured. Set STORAGE_PROVIDER and the required credentials (STORAGE_BUCKET, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY) to enable uploads.',
  [ERROR_CODES.STORAGE_OBJECT_NOT_FOUND]:
    'Your upload did not complete. The file is not in storage — please retry the upload, and ensure your network connection is stable.',
  [ERROR_CODES.UPLOAD_SIZE_MISMATCH]:
    'The file size we received does not match what was declared at upload time. Please retry the upload from the start.',
  [ERROR_CODES.RENDER_FAILED]:
    'Rendering failed. Check the job error message — if FFmpeg crashed, the source media may be corrupt or the codec unsupported.',
  [ERROR_CODES.RENDER_CANCELLED]:
    'Render cancelled. No output was produced.',
  [ERROR_CODES.RENDER_QUEUE_NOT_CONFIGURED]:
    'Rendering requires a background worker. Set REDIS_URL to enable exports.',
  [ERROR_CODES.TRANSCRIPTION_FAILED]:
    'Transcription failed. Check that the audio track is present and non-empty, then retry.',
  [ERROR_CODES.TRANSCRIPTION_PROVIDER_NOT_CONFIGURED]:
    'Transcription requires an AI provider. Set TRANSCRIPTION_PROVIDER and TRANSCRIPTION_API_KEY.',
  [ERROR_CODES.TRANSLATION_PROVIDER_NOT_CONFIGURED]:
    'Translation requires an AI provider. Set TRANSLATION_PROVIDER (default "zai" uses z-ai-web-dev-sdk).',
  [ERROR_CODES.AI_PROVIDER_ERROR]:
    'The AI provider returned an error. Try again in a moment — if the problem persists, check your API key and quota.',
  [ERROR_CODES.AI_JOB_NOT_IMPLEMENTED]:
    'This AI feature is not yet implemented. Check back later — we are rolling out new AI tools regularly.',
  [ERROR_CODES.PROJECT_NOT_FOUND]:
    'Project not found. It may have been deleted, or the link may have expired.',
  [ERROR_CODES.PROJECT_ACCESS_DENIED]:
    'You do not have access to this project. Ask the owner to share it with you, or sign in with the correct account.',
  [ERROR_CODES.INVALID_PROJECT]:
    'The project cannot be rendered as-is. Add at least one clip to the timeline and ensure every referenced asset has finished uploading.',
  [ERROR_CODES.UNAUTHORIZED]:
    'Please sign in to continue.',
  [ERROR_CODES.RATE_LIMITED]:
    'You are doing that too fast. Please wait a moment and try again.',
  [ERROR_CODES.VALIDATION_ERROR]:
    'Some of the data you sent was invalid. Please review the form and try again.',
};

/**
 * Map a backend error code to a user-friendly message.
 * Falls back to `fallback` if the code is not recognized (so callers can pass
 * a context-specific default like "Upload failed" instead of leaking the raw
 * code string).
 */
export function mapErrorCodeToUserMessage(code: string, fallback: string): string {
  const known = MESSAGES[code as ErrorCode];
  return known ?? fallback;
}

/**
 * Format an ApiError JSON envelope (`{ error: { code, message, details } }`)
 * into a single user-facing string. Used by fetch wrappers that want to
 * extract a toast message from a non-OK response.
 */
export function extractApiErrorMessage(responseBody: unknown, fallback: string): string {
  if (responseBody && typeof responseBody === 'object') {
    const err = (responseBody as any).error;
    if (err && typeof err === 'object') {
      const code = typeof err.code === 'string' ? err.code : '';
      const message = typeof err.message === 'string' ? err.message : '';
      if (code) {
        return mapErrorCodeToUserMessage(code, message || fallback);
      }
      if (message) return message;
    }
    // Some legacy routes return `{ error: "string" }` directly.
    if (typeof (responseBody as any).error === 'string') {
      return (responseBody as any).error as string;
    }
  }
  return fallback;
}
