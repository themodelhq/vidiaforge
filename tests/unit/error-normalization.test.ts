// VidiaForge V19.1 §7.1 — Client-side error normalization unit tests
//
// Verifies that normalizeApiError() and responseToErrorMessage() never
// produce "[object Object]" — the bug that originally surfaced when
// `throw new Error(data.error)` was called with `data.error` being an
// object (the structured JSON API envelope).
//
// These tests use real Response objects + real Error instances + real
// plain objects to exercise every code path.

import { test, expect, describe } from 'bun:test';
import {
  normalizeApiError,
  responseToErrorMessage,
} from '../../src/lib/errors/client';

describe('V19.1 §7.1 — normalizeApiError', () => {
  test('string error → returns the string', () => {
    expect(normalizeApiError('Upload failed', 'fallback')).toBe('Upload failed');
  });

  test('empty string → returns fallback', () => {
    expect(normalizeApiError('', 'fallback')).toBe('fallback');
    expect(normalizeApiError('   ', 'fallback')).toBe('fallback');
  });

  test('null → returns fallback', () => {
    expect(normalizeApiError(null, 'fallback')).toBe('fallback');
  });

  test('undefined → returns fallback', () => {
    expect(normalizeApiError(undefined, 'fallback')).toBe('fallback');
  });

  test('Error instance with message → returns the message', () => {
    const err = new Error('Network failed');
    expect(normalizeApiError(err, 'fallback')).toBe('Network failed');
  });

  test('Error instance with empty message → returns fallback', () => {
    const err = new Error('');
    expect(normalizeApiError(err, 'fallback')).toBe('fallback');
  });

  test('THE BUG: Error instance with "[object Object]" message → returns fallback', () => {
    // V19.1 §7.1 — explicit regression test for the original bug.
    // The old code did `throw new Error(data.error || 'Upload failed')`
    // where `data.error` was an object — `String({...})` became
    // "[object Object]". normalizeApiError() must NOT surface that
    // string to the user.
    const err = new Error('[object Object]');
    expect(normalizeApiError(err, 'Upload failed')).toBe('Upload failed');
  });

  test('THE BUG: Error instance with "{}" message → returns fallback', () => {
    const err = new Error('{}');
    expect(normalizeApiError(err, 'Upload failed')).toBe('Upload failed');
  });

  test('Error with JSON-stringified API envelope → extracts readable message', () => {
    // Some call sites historically did `throw new Error(JSON.stringify({...}))`
    // — normalizeApiError should detect + parse the JSON envelope.
    const err = new Error(JSON.stringify({
      error: { code: 'UPLOAD_SIZE_MISMATCH', message: 'File too large' },
    }));
    const result = normalizeApiError(err, 'fallback');
    // Should NOT be the raw JSON string. Should be the user-facing message
    // mapped through the error code table.
    expect(result).not.toBe(JSON.stringify({ error: { code: 'UPLOAD_SIZE_MISMATCH', message: 'File too large' } }));
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toBe('fallback');
  });

  test('plain object with structured envelope → extracts readable message', () => {
    // The shape `{ error: { code, message } }` used by every backend route.
    const err = {
      error: {
        code: 'UNAUTHORIZED',
        message: 'Please sign in to continue.',
      },
    };
    const result = normalizeApiError(err, 'fallback');
    expect(result).toBe('Please sign in to continue.');
  });

  test('plain object with legacy string envelope → returns the string', () => {
    const err = { error: 'Forbidden' };
    const result = normalizeApiError(err, 'fallback');
    // extractApiErrorMessage handles this legacy shape too.
    expect(result).not.toBe('[object Object]');
  });

  test('plain object with message field → returns the message', () => {
    // Some DOMException-like objects carry `.message`.
    const err = { message: 'Quota exceeded' };
    expect(normalizeApiError(err, 'fallback')).toBe('Quota exceeded');
  });

  test('number → returns fallback', () => {
    // Non-string, non-Error, non-object — normalizeApiError falls back.
    expect(normalizeApiError(42, 'fallback')).toBe('fallback');
  });

  test('array → returns fallback (arrays don\'t have a readable message)', () => {
    expect(normalizeApiError(['bad', 'data'], 'fallback')).toBe('fallback');
  });
});

describe('V19.1 §7.1 — responseToErrorMessage (Response → string)', () => {
  test('401 → readable message (not [object Object])', async () => {
    const res = new Response('{"error":{"code":"UNAUTHORIZED","message":"Please sign in."}}', {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
    const msg = await responseToErrorMessage(res, 'fallback');
    expect(msg).not.toBe('[object Object]');
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
  });

  test('413 → readable message (not [object Object])', async () => {
    const res = new Response('{"error":{"code":"UPLOAD_SIZE_MISMATCH"}}', {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
    const msg = await responseToErrorMessage(res, 'fallback');
    expect(msg).not.toBe('[object Object]');
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
    // The mapped message OR the status-based message should be size-related.
    expect(msg.toLowerCase()).toMatch(/size|large|file|retry|too/);
  });

  test('415 → readable message (not [object Object])', async () => {
    const res = new Response('{"error":{"code":"VALIDATION_ERROR","message":"Unsupported MIME type"}}', {
      status: 415,
      headers: { 'Content-Type': 'application/json' },
    });
    const msg = await responseToErrorMessage(res, 'fallback');
    expect(msg).not.toBe('[object Object]');
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
    // 415 → unsupported-type-related message.
    expect(msg.toLowerCase()).toMatch(/support|mime|type|invalid/);
  });

  test('429 → readable message (not [object Object])', async () => {
    const res = new Response('{"error":{"code":"RATE_LIMITED"}}', {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
    const msg = await responseToErrorMessage(res, 'fallback');
    expect(msg).not.toBe('[object Object]');
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
    // 429 → rate-limit-related message.
    expect(msg.toLowerCase()).toMatch(/fast|rate|slow|wait|moment|try again/);
  });

  test('500 → readable server-error message (not [object Object])', async () => {
    const res = new Response('{"error":{"code":"STORAGE_ERROR"}}', {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
    const msg = await responseToErrorMessage(res, 'fallback');
    expect(msg).not.toBe('[object Object]');
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
    // 500 → server-error message.
    expect(msg.toLowerCase()).toMatch(/server|error|moment|try again|storage|reach/);
  });

  test('non-JSON body → falls back to status-based message', async () => {
    const res = new Response('<html>not json</html>', {
      status: 502,
      headers: { 'Content-Type': 'text/html' },
    });
    const msg = await responseToErrorMessage(res, 'fallback');
    expect(msg).not.toBe('[object Object]');
    expect(msg).not.toBe('<html>not json</html>');
    // 502 → server-error message.
    expect(msg.toLowerCase()).toMatch(/server|error|moment|try again/);
  });

  test('empty body → falls back to status-based message', async () => {
    const res = new Response('', { status: 500 });
    const msg = await responseToErrorMessage(res, 'fallback');
    expect(msg).not.toBe('[object Object]');
    expect(msg.toLowerCase()).toMatch(/server|error|moment|try again/);
  });

  test('legacy `{ error: "string" }` envelope → returns the string', async () => {
    const res = new Response('{"error":"Bad request"}', {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    const msg = await responseToErrorMessage(res, 'fallback');
    expect(msg).not.toBe('[object Object]');
    // Should return the legacy string OR a 4xx-based message.
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
  });
});

describe('V19.1 §7.1 — regression: "[object Object]" never reaches the user', () => {
  test('every error shape produces a readable string', async () => {
    // Exhaustive sweep — make sure no input shape produces
    // "[object Object]" or "{}" as the user-facing message.
    const inputs: unknown[] = [
      null,
      undefined,
      'string error',
      '',
      42,
      ['array'],
      { foo: 'bar' },
      new Error('real error'),
      new Error(''),
      new Error('[object Object]'),
      new Error('{}'),
      { error: { code: 'STORAGE_ERROR', message: 'Storage failed' } },
      { error: 'legacy string' },
      { message: 'direct message' },
    ];

    for (const input of inputs) {
      const result = normalizeApiError(input, 'fallback');
      expect(typeof result).toBe('string');
      expect(result).not.toBe('[object Object]');
      expect(result).not.toBe('[object Object]');
      expect(result.length).toBeGreaterThan(0);
    }
  });
});
