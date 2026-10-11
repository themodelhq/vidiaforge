import { describe, expect, test } from 'bun:test';
import { isDiagnosticsBearerAuthorized } from '../../lib/render/diagnostics-auth';

describe('isDiagnosticsBearerAuthorized', () => {
  const token = 'test-render-diagnostics-token';

  test('accepts a matching Bearer token', () => {
    expect(isDiagnosticsBearerAuthorized(`Bearer ${token}`, token)).toBe(true);
  });

  test('accepts case-insensitive Bearer scheme and surrounding whitespace', () => {
    expect(isDiagnosticsBearerAuthorized(`bearer   ${token}  `, ` ${token} `)).toBe(true);
  });

  test('rejects a mismatched token', () => {
    expect(isDiagnosticsBearerAuthorized('Bearer wrong-token', token)).toBe(false);
  });

  test('rejects missing, blank, or malformed credentials', () => {
    expect(isDiagnosticsBearerAuthorized(null, token)).toBe(false);
    expect(isDiagnosticsBearerAuthorized('Bearer ', token)).toBe(false);
    expect(isDiagnosticsBearerAuthorized(token, token)).toBe(false);
    expect(isDiagnosticsBearerAuthorized('Basic abc', token)).toBe(false);
    expect(isDiagnosticsBearerAuthorized('Bearer token', undefined)).toBe(false);
    expect(isDiagnosticsBearerAuthorized('Bearer token', '   ')).toBe(false);
  });
});
