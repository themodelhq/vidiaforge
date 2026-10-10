// VidiaForge Worker — AIJOB_TEST_HOLD barrier
//
// V17.1 §9-11: Deterministic file-based barrier used by the integration test
// to pause the transcription processor at a known point AFTER:
//   - atomic claim has succeeded
//   - heartbeat has become observable
// and BEFORE:
//   - completion (any irreversible finalization)
//
// Safety contract (V17.1 §10):
//   - The hold is TEST-ONLY and disabled by default.
//   - It activates ONLY when ALL of the following are true:
//       1. AIJOB_TEST_HOLD=true is set
//       2. NODE_ENV === 'test'  (the dedicated test environment)
//   - It MUST NOT activate in production even if AIJOB_TEST_HOLD=true is set.
//   - The implementation fails closed: any ambiguity → no hold.
//
// Behavior:
//   When active, the processor creates a sentinel file:
//     /tmp/vidiaforge-aijob-hold-{aiJobId}.holding
//   then polls for the absence of that file (or a sibling .release file).
//   The integration test:
//     1. waits for the .holding file to appear (proves hold is active)
//     2. SIGKILLs Worker A (simulates crash while paused)
//     3. verifies the lease expires + recovery runs + Worker B takes over
//
//   For Worker B (which doesn't need to be held), the test simply doesn't
//   set AIJOB_TEST_HOLD, so the barrier returns immediately.
//
// The hold is bounded by a maximum wait (default 5 minutes) so a forgotten
// sentinel file can't pin a worker forever.

import { existsSync, mkdirSync, writeFileSync, unlinkSync, statSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import process from 'process';

const HOLD_DIR = process.env.AIJOB_TEST_HOLD_DIR || tmpdir();
const HOLD_MAX_MS = parseInt(
  process.env.AIJOB_TEST_HOLD_MAX_MS || String(5 * 60 * 1000),
  10
);
const HOLD_POLL_MS = 100;

/**
 * Returns true if the test hold should be active for this process.
 *
 * V17.1 §10: FAIL CLOSED.
 *   - AIJOB_TEST_HOLD must be exactly 'true'
 *   - NODE_ENV must be exactly 'test'
 *   - Any other combination → false (no hold, even if env var is set)
 *
 * This prevents a misconfigured production deployment from accidentally
 * activating the hold.
 */
export function isTestHoldActive(): boolean {
  // V17.1 §10: MUST NOT activate in production.
  if (process.env.NODE_ENV === 'production') return false;
  // Only activate in test mode.
  if (process.env.NODE_ENV !== 'test') return false;
  // Must be explicitly enabled.
  return process.env.AIJOB_TEST_HOLD === 'true';
}

/**
 * Returns the path to the sentinel file for a given aiJobId.
 *
 * Two files are used per job:
 *   {prefix}.holding  — created by the worker to signal "I am paused here"
 *   {prefix}.release  — created by the test to signal "you may proceed"
 *
 * The barrier releases when EITHER:
 *   - the .release file exists (explicit release — used for non-SIGKILL tests)
 *   - the .holding file no longer exists (worker was killed; on restart the
 *     hold would not be active anyway — but if the SAME process is still
 *     polling, this would mean the file was removed externally)
 *
 * In the crash-recovery test, Worker A is SIGKILLed while paused, so the
 * test never needs to release the hold — Worker A is simply dead.
 */
export function holdFilePath(aiJobId: string): string {
  // Sanitize the aiJobId to prevent path traversal.
  const safe = aiJobId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(HOLD_DIR, `vidiaforge-aijob-hold-${safe}.holding`);
}

export function releaseFilePath(aiJobId: string): string {
  const safe = aiJobId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(HOLD_DIR, `vidiaforge-aijob-hold-${safe}.release`);
}

/**
 * Mark the hold as active for this aiJobId by writing the sentinel file.
 * Returns the path to the sentinel so the processor can clean it up later.
 */
export function markHoldActive(aiJobId: string): string {
  const filePath = holdFilePath(aiJobId);
  try {
    // Ensure dir exists (in case HOLD_DIR is a non-existent path).
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify({
      aiJobId,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }));
  } catch (err) {
    // Best-effort — if we can't write the sentinel, the test will fall back
    // to polling the DB for the heartbeat. Don't crash the processor.
    console.warn(
      `[test-hold] failed to write sentinel file ${filePath}:`,
      err instanceof Error ? err.message : err
    );
  }
  return filePath;
}

/**
 * Wait for the hold to release. Used by the transcription processor.
 *
 * Returns true if released via .release file or external removal of .holding,
 * false if the maximum hold time elapsed.
 *
 * In the crash-recovery test, the processor is SIGKILLed while inside this
 * function — it never returns. Worker B, which runs without AIJOB_TEST_HOLD,
 * skips this function entirely (the caller checks isTestHoldActive() first).
 */
export async function waitForHoldRelease(aiJobId: string): Promise<boolean> {
  if (!isTestHoldActive()) return true;

  const holdFile = holdFilePath(aiJobId);
  const releaseFile = releaseFilePath(aiJobId);

  // Mark active so the test can verify we reached the hold.
  markHoldActive(aiJobId);

  console.log(
    `[test-hold] AIJob ${aiJobId} entering test hold — ` +
    `sentinel=${holdFile} maxWait=${HOLD_MAX_MS}ms`
  );

  const deadline = Date.now() + HOLD_MAX_MS;
  while (Date.now() < deadline) {
    // Release conditions:
    //   - .release file exists (explicit release by test)
    //   - .holding file removed externally (worker should die, but if it's
    //     still alive and the file was removed, treat as release)
    if (existsSync(releaseFile)) {
      console.log(`[test-hold] AIJob ${aiJobId} — release signal received`);
      cleanup(aiJobId);
      return true;
    }
    if (!existsSync(holdFile)) {
      // The .holding file was removed — probably because the test cleaned up.
      console.log(`[test-hold] AIJob ${aiJobId} — sentinel removed externally`);
      return true;
    }
    await sleep(HOLD_POLL_MS);
  }

  // Timed out — proceed anyway so we don't pin the worker forever.
  console.warn(
    `[test-hold] AIJob ${aiJobId} — hold timed out after ${HOLD_MAX_MS}ms, proceeding`
  );
  cleanup(aiJobId);
  return false;
}

/**
 * Remove the sentinel files for a given aiJobId. Called by the processor's
 * finally block so test runs don't leave stale files in /tmp.
 */
export function cleanup(aiJobId: string): void {
  try { unlinkSync(holdFilePath(aiJobId)); } catch { /* fine */ }
  try { unlinkSync(releaseFilePath(aiJobId)); } catch { /* fine */ }
}

/**
 * Test helper: wait until the sentinel file exists (proves Worker A reached
 * the hold). Used by the integration test before SIGKILL.
 */
export async function waitForHoldActive(
  aiJobId: string,
  timeoutMs = 30_000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const filePath = holdFilePath(aiJobId);
  while (Date.now() < deadline) {
    try {
      const st = statSync(filePath);
      if (st.isFile()) return true;
    } catch {
      // File doesn't exist yet — keep polling.
    }
    await sleep(100);
  }
  return false;
}

/**
 * Test helper: release the hold by creating the .release file.
 * Used by tests that want Worker A to proceed (not the crash-recovery test,
 * which SIGKILLs Worker A instead).
 */
export function releaseHold(aiJobId: string): void {
  try {
    mkdirSync(path.dirname(releaseFilePath(aiJobId)), { recursive: true });
    writeFileSync(releaseFilePath(aiJobId), new Date().toISOString());
  } catch (err) {
    console.warn(
      `[test-hold] failed to write release file:`,
      err instanceof Error ? err.message : err
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
