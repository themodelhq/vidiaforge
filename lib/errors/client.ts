// VidiaForge — Client-side error normalization (V19.1 §5.C)
//
// Centralized utility that converts ANY error value (string, Error, fetch
// failure, JSON API error envelope, validation error, unknown) into a single
// human-readable string suitable for toasts and inline banners.
//
// This is the SINGLE source of truth for "what to show the user when an API
// call fails". Frontend components should never `throw new Error(data.error)`
// when `data.error` is an object — that produces "[object Object]". They
// should call `normalizeApiError(e, fallback)` instead.
//
// Re-uses the backend `extractApiErrorMessage` mapping so frontend messages
// stay consistent with the documented user-facing copy in
// `src/lib/errors/user-messages.ts`.

import { extractApiErrorMessage } from './user-messages';

/**
 * Safely parse a Response body as JSON. Returns `null` if the body is not
 * valid JSON or is empty (so callers can fall back to text).
 */
export async function safeJson(response: Response): Promise<unknown | null> {
  try {
    const text = await response.text();
    if (!text || !text.trim()) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Read a fetch Response that is expected to be JSON and turn it into a
 * user-facing error message string.
 *
 * - Honors the structured `{ error: { code, message, details } }` envelope
 *   used by every backend route.
 * - Honors legacy `{ error: "string" }` envelopes.
 * - Falls back to a status-based message (401 → "Please sign in to continue."
 *   etc.) when the body is unparseable or missing.
 * - Falls back to `fallback` when nothing else produces a message.
 */
export async function responseToErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  // 1. Try structured JSON envelope first
  const body = await safeJson(response);
  if (body && typeof body === 'object') {
    const msg = extractApiErrorMessage(body, fallback);
    if (msg && msg !== fallback) return msg;
    // body has no recognizable error field — fall through to status mapping
  } else if (typeof body === 'string' && body.trim()) {
    return body.trim();
  }

  // 2. Fall back to status-code based messages
  if (response.status === 401) return 'Please sign in to continue.';
  if (response.status === 403) return 'You do not have permission to do that.';
  if (response.status === 404) return 'We could not find that resource.';
  if (response.status === 413) return 'The file is too large to upload.';
  if (response.status === 415) return 'This file type is not supported.';
  if (response.status === 429) return 'You are doing that too fast. Please wait a moment and try again.';
  if (response.status >= 500) return 'The server had an unexpected error. Please try again in a moment.';

  return fallback;
}

/**
 * Convert ANY thrown error value into a user-facing string. This is the
 * function components should call in their `catch` blocks instead of
 * `e instanceof Error ? e.message : '...'` — that pattern silently produces
 * `[object Object]` when the thrown value is an object.
 */
export function normalizeApiError(err: unknown, fallback: string): string {
  if (err == null) return fallback;

  if (typeof err === 'string') {
    return err.trim() || fallback;
  }

  if (err instanceof Error) {
    // Some call sites throw `new Error(JSON.stringify({ error: ... }))` —
    // try to parse the message back into structured form before using it.
    const msg = err.message?.trim() || '';
    if (msg) {
      // Detect "[object Object]" specifically — this is the symptom of the
      // bug we're fixing, and we want to replace it with a useful fallback
      // rather than show it to the user.
      if (msg === '[object Object]' || msg === '{}') {
        return fallback;
      }
      // Try to parse it as a JSON API envelope
      if (msg.startsWith('{') || msg.startsWith('[')) {
        try {
          const parsed = JSON.parse(msg);
          const extracted = extractApiErrorMessage(parsed, fallback);
          if (extracted && extracted !== fallback) return extracted;
        } catch {
          // not JSON — fall through and return the raw message
        }
      }
      return msg;
    }
    return fallback;
  }

  if (typeof err === 'object') {
    // Object literal — likely a structured API error envelope
    const extracted = extractApiErrorMessage(err, fallback);
    if (extracted && extracted !== fallback) return extracted;

    // Some errors carry a `message` field directly (e.g. DOMException)
    const anyErr = err as { message?: unknown; error?: unknown; details?: unknown };
    if (typeof anyErr.message === 'string' && anyErr.message.trim()) {
      return anyErr.message.trim();
    }
    if (typeof anyErr.error === 'string' && anyErr.error.trim()) {
      return anyErr.error.trim();
    }
  }

  return fallback;
}

/**
 * Convenience wrapper: call `fetch()` and, if the response is not ok, throw
 * an `Error` whose `.message` is a user-facing string (NOT a raw object).
 *
 * Use this anywhere a route is expected to return JSON and the caller just
 * wants to "throw on failure and show the message in a toast".
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  fallback = 'Request failed',
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (err) {
    // Network failure, CORS, DNS, etc.
    if (err instanceof TypeError) {
      throw new Error('Network error — please check your connection and try again.');
    }
    throw new Error(normalizeApiError(err, fallback));
  }
  if (!res.ok) {
    const msg = await responseToErrorMessage(res, fallback);
    const err = new Error(msg);
    (err as any).status = res.status;
    throw err;
  }
  return res;
}
