import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Authorize the protected diagnostics endpoint with a configured Bearer token.
 * Hash both values first so timingSafeEqual always receives fixed-length buffers.
 */
export function isDiagnosticsBearerAuthorized(
  authorizationHeader: string | null,
  configuredToken: string | undefined,
): boolean {
  if (!configuredToken?.trim() || !authorizationHeader) return false;

  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader);
  if (!match) return false;

  const providedToken = match[1].trim();
  const expectedToken = configuredToken.trim();
  if (!providedToken || !expectedToken) return false;

  const providedHash = createHash('sha256').update(providedToken, 'utf8').digest();
  const expectedHash = createHash('sha256').update(expectedToken, 'utf8').digest();
  return timingSafeEqual(providedHash, expectedHash);
}
