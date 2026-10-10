// VidiaForge — ApiError class (S2)
//
// A typed, structured error for API route handlers. Construct one of the
// factory helpers (notFound, unauthorized, forbidden, validationError,
// rateLimited, serviceUnavailable) and call .toResponse() to get a NextResponse
// with the standard `{ error: { code, message, details } }` envelope.
//
// Frontend maps the `code` to a friendly user-facing message via
// `mapErrorCodeToUserMessage()` (see ./user-messages.ts).
//
// Conventions:
//   - statusCode follows HTTP semantics (4xx for client errors, 5xx for server).
//   - `details` is OPTIONAL and only included when it adds debugging value
//     (e.g. validation error paths, underlying provider error message). Never
//     include secrets, tokens, or PII.
//   - `message` is a short, human-readable summary suitable for the toast UI.
//   - The `code` is the stable identifier the frontend switches on.

import { NextResponse } from 'next/server';
import { ERROR_CODES, type ErrorCode } from './codes';

export interface ApiErrorJson {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number,
    details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }

  toJSON(): ApiErrorJson {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }

  toResponse(): NextResponse<ApiErrorJson> {
    return NextResponse.json(this.toJSON(), { status: this.statusCode });
  }
}

// === Factory helpers ===
// Each factory maps to a stable (code, statusCode) pair so callers don't have
// to remember the HTTP semantics for each code.

export function notFound(code: ErrorCode = ERROR_CODES.PROJECT_NOT_FOUND, message?: string, details?: unknown): ApiError {
  // Default to PROJECT_NOT_FOUND, but allow callers to pass MEDIA_NOT_FOUND etc.
  const msg = message ?? defaultMessageFor(code);
  return new ApiError(code, msg, 404, details);
}

export function unauthorized(message: string = 'Authentication required.', details?: unknown): ApiError {
  return new ApiError(ERROR_CODES.UNAUTHORIZED, message, 401, details);
}

export function forbidden(message: string = 'You do not have access to this resource.', details?: unknown): ApiError {
  return new ApiError(ERROR_CODES.PROJECT_ACCESS_DENIED, message, 403, details);
}

export function validationError(details: unknown, message: string = 'Validation failed.'): ApiError {
  return new ApiError(ERROR_CODES.VALIDATION_ERROR, message, 400, details);
}

export function rateLimited(message: string = 'Too many requests. Please slow down.', details?: unknown): ApiError {
  return new ApiError(ERROR_CODES.RATE_LIMITED, message, 429, details);
}

export function serviceUnavailable(code: ErrorCode, message: string, details?: unknown): ApiError {
  // Generic 503 — used by RENDER_QUEUE_NOT_CONFIGURED, TRANSCRIPTION_PROVIDER_NOT_CONFIGURED,
  // TRANSLATION_PROVIDER_NOT_CONFIGURED, STORAGE_NOT_CONFIGURED.
  return new ApiError(code, message, 503, details);
}

// === Internal helpers ===

function defaultMessageFor(code: ErrorCode): string {
  switch (code) {
    case ERROR_CODES.MEDIA_NOT_FOUND:
      return 'Media asset not found.';
    case ERROR_CODES.PROJECT_NOT_FOUND:
      return 'Project not found.';
    default:
      return 'Resource not found.';
  }
}
