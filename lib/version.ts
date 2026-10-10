// VidiaForge V19.1 — Single Source of Truth for Version
//
// V19.1 §4: Every current certification, UI, diagnostics, report, feature
// matrix, and API metadata must use the SAME version string from this file.
//
// Never hard-code the version repeatedly — import from here.
//
// V19.1 §3: The current release is consistently "V19.1".
// Historical documents may retain their original version but must be
// explicitly marked as HISTORICAL.

import { execFileSync } from 'child_process';

export const APP_VERSION = '19.1' as const;
export const RELEASE_NAME = 'VidiaForge V19.1' as const;
export const FULL_VERSION = `VidiaForge V${APP_VERSION}` as const;

/**
 * Certification version stamp used in all evidence artifacts.
 * Format: V19.1_<timestamp>
 */
export function certificationRunId(): string {
  return `VIDIAFORGE_CERT_V19_1_${Date.now()}`;
}

/**
 * Get the current Git SHA (short) for evidence attribution.
 * Returns 'unknown' if git is unavailable.
 */
export function getGitSha(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}
