// VidiaForge v17.1 — Certification test mode helpers
//
// V17.1 §33-36: Three test modes with distinct semantics:
//
//   DEVELOPMENT — optional dependencies may be skipped with a console message
//                 (e.g., "SKIP: FFprobe unavailable"). Developer smoke tests.
//
//   CERTIFICATION — mandatory dependencies may NOT be silently skipped. If
//                   unavailable, the test MUST throw CertificationBlockedError
//                   which the runner reports as BLOCKED (exit code 2).
//
//   PRODUCTION — missing mandatory infrastructure is FAIL (exit 1), never SKIP.
//
// The certification runner maps:
//   PASS = exit 0
//   FAIL = exit 1
//   BLOCKED = exit 2
//
// V17.1 Rule 6: certification mode must NEVER silently pass. This module
// provides the helpers that enforce that contract.

/**
 * Thrown when a mandatory certification dependency is unavailable.
 * The certification runner catches this and reports BLOCKED (exit 2).
 */
export class CertificationBlockedError extends Error {
  public readonly blockedReason: string;
  public readonly blockedCategory: string;

  constructor(category: string, reason: string) {
    super(`CERTIFICATION BLOCKED — ${category}: ${reason}`);
    this.name = 'CertificationBlockedError';
    this.blockedCategory = category;
    this.blockedReason = reason;
  }
}

export type TestMode = 'development' | 'certification' | 'production';

/**
 * Detect the active test mode from the environment.
 *
 * V17.1 §34:
 *   - NODE_ENV=production + CERTIFICATION_MODE=true → 'production' (strictest)
 *   - CERTIFICATION_MODE=true (alone) → 'certification'
 *   - otherwise → 'development'
 *
 * In 'production' mode, missing infra is FAIL (exit 1) — we never report SKIP.
 * In 'certification' mode, missing infra is BLOCKED (exit 2).
 * In 'development' mode, missing infra is SKIP (exit 0, test omitted).
 */
export function getTestMode(): TestMode {
  if (process.env.NODE_ENV === 'production') return 'production';
  if (process.env.CERTIFICATION_MODE === 'true') return 'certification';
  return 'development';
}

/**
 * Returns true if the test should treat missing infra as a hard failure
 * (BLOCKED or FAIL) rather than a SKIP.
 */
export function isHardFailureMode(): boolean {
  return getTestMode() !== 'development';
}

/**
 * V17.1 §36: Check infrastructure availability. In hard-failure mode,
 * throw CertificationBlockedError. In development mode, return false (skip).
 *
 * Usage:
 *   if (!await requireInfra('PostgreSQL', infraCheck.postgresql)) return;
 *
 *   // OR — multiple at once:
 *   await requireInfraAll({
 *     PostgreSQL: infraCheck.postgresql,
 *     Redis: infraCheck.redis,
 *   });
 */
export async function requireInfra(
  name: string,
  available: boolean
): Promise<boolean> {
  if (available) return true;

  const mode = getTestMode();
  if (mode === 'development') {
    console.log(`SKIP: ${name} unavailable (development mode)`);
    return false;
  }
  if (mode === 'certification') {
    throw new CertificationBlockedError(name, `${name} is not available`);
  }
  // production
  throw new Error(`FAIL: ${name} unavailable in production mode`);
}

/**
 * V17.1 §36: Require ALL listed infra to be available.
 * Throws on the FIRST missing one (fail fast).
 */
export async function requireInfraAll(
  requirements: Record<string, boolean>
): Promise<void> {
  for (const [name, available] of Object.entries(requirements)) {
    if (!available) {
      await requireInfra(name, false);
    }
  }
}

/**
 * V17.1 §35: Maps a test outcome to the correct process exit code.
 *
 *   PASS → 0
 *   FAIL → 1
 *   BLOCKED → 2
 */
export function exitCodeForOutcome(
  outcome: 'PASS' | 'FAIL' | 'BLOCKED'
): number {
  switch (outcome) {
    case 'PASS':
      return 0;
    case 'FAIL':
      return 1;
    case 'BLOCKED':
      return 2;
    default:
      return 1;
  }
}

/**
 * V17.1 §49: Polls a condition until it returns true OR the timeout elapses.
 * Returns true if the condition became true, false on timeout.
 *
 * On timeout, calls onTimeout with diagnostic context (so the test can print
 * current AIJob state, worker process state, etc.).
 */
export async function waitForCondition<T>(
  fn: () => Promise<T | false>,
  opts: {
    timeoutMs?: number;
    pollMs?: number;
    /** V17.1: Optional label for diagnostic logging. */
    label?: string;
    onProgress?: (result: T | false, attempt: number) => void;
    onTimeout?: () => void;
  } = {}
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const pollMs = opts.pollMs ?? 500;
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    try {
      const result = await fn();
      if (result) {
        return true;
      }
      if (opts.onProgress) opts.onProgress(result, attempt);
    } catch (err) {
      if (opts.onProgress) {
        opts.onProgress(err as T, attempt);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  if (opts.onTimeout) opts.onTimeout();
  return false;
}
