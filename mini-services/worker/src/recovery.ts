// VidiaForge Worker — Canonical Production Recovery
//
// V17.1 §4-7: Single source of truth for stale AIJob recovery.
// This module is imported by:
//   - mini-services/worker/src/index.ts (real worker startup + scheduler)
//   - tests/worker-integration/crash-recovery.test.ts (certification test)
//
// The test MUST invoke the same recoverStaleJobs() function the production
// worker uses — never duplicate the recovery SQL inside the test.
//
// Recovery contract (V17.1 §5 + §6):
//   1. locate stale AIJobs (status='processing' AND stale lease)
//   2. correctly handle NULL heartbeat (use processingStartedAt fallback)
//   3. atomically recover only jobs that are STILL stale at update time
//   4. clear stale ownership (workerId/attemptId/heartbeatAt → null)
//   5. preserve attempt counter (do NOT reset — historical record)
//   6. reset job to retryable state (status='queued')
//   7. REQUEUE through the REAL BullMQ queue (NOT manual DB mutation)
//   8. prevent duplicate recovery (atomic WHERE clause)
//   9. preserve stale-attempt protection (old workerId/attemptId no longer match)
//  10. emit structured logs
//  11. return useful recovery statistics
//
// Atomic stale condition (V17.1 §6):
//   status = 'processing'
//   AND (
//     heartbeatAt < staleCutoff
//     OR (heartbeatAt IS NULL AND processingStartedAt < staleCutoff)
//   )

import type { PrismaClient } from '@prisma/client';

const lib = '../../../src/lib';

export interface RecoveryStats {
  scanned: number;
  recovered: number;
  requeued: number;
  skipped: number;
  errors: string[];
  recoveredJobIds: string[];
}

export interface RecoveryOptions {
  /** Override the lease cutoff (default: from AI_JOB_LEASE_MS env var). */
  leaseMs?: number;
  /** If true, skip the BullMQ requeue (used by the recovery DRY-RUN path). */
  skipRequeue?: boolean;
  /** Optional logger (defaults to console). */
  log?: (msg: string) => void;
}

/**
 * Recover stale AIJobs through the canonical production path.
 *
 * Steps per stale job:
 *   1. ATOMIC conditional updateMany (only affects rows still stale at the
 *      moment of the update — race-safe against concurrent workers/heartbeats).
 *   2. For each recovered row, REQUEUE the job through the real BullMQ
 *      abstraction (src/lib/queue.ts enqueue()) so a new worker can pick it
 *      up with a fresh attemptId.
 *
 * Returns statistics for observability + certification evidence.
 */
export async function recoverStaleJobs(
  db: PrismaClient,
  options: RecoveryOptions = {}
): Promise<RecoveryStats> {
  const log = options.log ?? ((m: string) => console.log(m));
  const stats: RecoveryStats = {
    scanned: 0,
    recovered: 0,
    requeued: 0,
    skipped: 0,
    errors: [],
    recoveredJobIds: [],
  };

  const AI_JOB_LEASE_MS =
    options.leaseMs ??
    parseInt(process.env.AI_JOB_LEASE_MS || String(120_000), 10);
  const staleCutoff = new Date(Date.now() - AI_JOB_LEASE_MS);

  // Stale clause — handles NULL heartbeat via processingStartedAt fallback.
  // A job with NULL heartbeat AND recent processingStartedAt is NOT stale
  // (it may have just started and not sent its first heartbeat yet).
  const staleClause = {
    OR: [
      { heartbeatAt: { lt: staleCutoff } },
      {
        heartbeatAt: { equals: null },
        processingStartedAt: { lt: staleCutoff },
      },
    ],
  };

  try {
    // ── Scan: count stale jobs (informational; the actual update is atomic) ──
    const staleAiCount = await db.aIJob.count({
      where: {
        status: 'processing',
        ...staleClause,
      },
    });
    stats.scanned = staleAiCount;

    log(
      `[recovery] scanning AIJobs — leaseMs=${AI_JOB_LEASE_MS} ` +
      `staleCutoff=${staleCutoff.toISOString()} found=${staleAiCount}`
    );

    if (staleAiCount === 0) {
      log('[recovery] no stale AIJobs found');
      return stats;
    }

    // ── Fetch stale jobs (we need their input to re-enqueue) ──────────────
    // We fetch BEFORE the atomic update so we can preserve the input payload.
    // The atomic update below guarantees we only mutate jobs that are STILL
    // stale at update time — if a worker refreshed the heartbeat between
    // the fetch and the update, 0 rows are affected for that job.
    const staleJobs = await db.aIJob.findMany({
      where: {
        status: 'processing',
        ...staleClause,
      },
      select: {
        id: true,
        userId: true,
        projectId: true,
        kind: true,
        input: true,
        provider: true,
        attempt: true,
        workerId: true,
        attemptId: true,
        heartbeatAt: true,
        processingStartedAt: true,
      },
    });

    // ── ATOMIC recovery: stale processing → queued, ownership cleared ─────
    // This updateMany only affects rows that are STILL stale at this moment.
    // If a worker refreshed the heartbeat between findMany and updateMany,
    // that job's row no longer matches the WHERE clause and is NOT recovered.
    const recoveryResult = await db.aIJob.updateMany({
      where: {
        status: 'processing',
        ...staleClause,
      },
      data: {
        status: 'queued',
        error: 'Worker heartbeat expired — job re-queued for retry.',
        completedAt: null,
        // Clear stale ownership — new claim will set fresh workerId/attemptId
        workerId: null,
        attemptId: null,
        heartbeatAt: null,
        // NOTE: attempt counter is NOT reset — it keeps incrementing so we
        // can track how many times this job has been attempted (provenance).
      },
    });

    stats.recovered = recoveryResult.count;
    log(
      `[recovery] ATOMICALLY re-queued ${recoveryResult.count} stale AIJob(s) ` +
      `for retry (scanned=${staleAiCount})`
    );

    if (recoveryResult.count === 0) {
      // All jobs were claimed by live workers between scan + update — race-safe.
      stats.skipped = staleAiCount;
      log('[recovery] 0 jobs recovered — all were reclaimed by live workers');
      return stats;
    }

    // ── Requeue each recovered job through REAL BullMQ ───────────────────
    // V17.1 Rule 3: production recovery MUST perform the BullMQ requeue.
    // The test does NOT manually re-enqueue.
    if (!options.skipRequeue) {
      const { enqueue } = await import(`${lib}/queue`);
      const { QUEUE_NAMES } = await import(`${lib}/queue-names`);

      for (const job of staleJobs) {
        // Only requeue jobs that the atomic update actually recovered.
        // We can't perfectly tell which rows were updated without a separate
        // query, so we re-fetch each candidate and check its current status.
        // If the job is no longer 'queued' (e.g., another worker already
        // claimed it again, or it was completed), skip the requeue.
        const current = await db.aIJob.findUnique({
          where: { id: job.id },
          select: { status: true, workerId: true, attemptId: true },
        });

        if (!current || current.status !== 'queued' || current.workerId || current.attemptId) {
          // Either: (a) the atomic update didn't recover this job (race), OR
          // (b) another worker has already reclaimed it. Either way, skip
          // the requeue to avoid duplicate BullMQ messages.
          stats.skipped++;
          continue;
        }

        // Parse the original input to extract the queue payload fields.
        let parsedInput: any = {};
        try {
          parsedInput = job.input ? JSON.parse(job.input) : {};
        } catch {
          stats.errors.push(`AIJob ${job.id}: failed to parse input JSON`);
          continue;
        }

        // Build the queue payload — must contain all required identifiers.
        const payload: Record<string, unknown> = {
          aiJobId: job.id,
          assetId: parsedInput.assetId,
          projectId: job.projectId || parsedInput.projectId,
          language: parsedInput.language,
        };

        const enqResult = await enqueue(
          QUEUE_NAMES.TRANSCRIPTION,
          payload
        );

        if (enqResult.ok) {
          stats.requeued++;
          stats.recoveredJobIds.push(job.id);
          log(
            `[recovery] REQUEUED AIJob ${job.id} → BullMQ jobId=${enqResult.jobId} ` +
            `(previous attempt=${job.attempt} worker=${job.workerId})`
          );
        } else {
          stats.errors.push(
            `AIJob ${job.id}: BullMQ requeue failed — ${enqResult.error}`
          );
          log(
            `[recovery] FAILED to requeue AIJob ${job.id}: ${enqResult.error}`
          );

          // Roll back the recovery so the job isn't stranded in 'queued'
          // with no BullMQ message — restore 'processing' state with the old
          // ownership so a future recovery pass can try again.
          try {
            await db.aIJob.update({
              where: { id: job.id },
              data: {
                status: 'processing',
                workerId: job.workerId,
                attemptId: job.attemptId,
                heartbeatAt: job.heartbeatAt,
                processingStartedAt: job.processingStartedAt,
                error: `Requeue failed: ${enqResult.error}`,
              },
            });
          } catch (rollbackErr) {
            stats.errors.push(
              `AIJob ${job.id}: rollback failed — ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`
            );
          }
        }
      }
    } else {
      // DRY-RUN mode — count as recovered but don't requeue.
      stats.requeued = 0;
      stats.recoveredJobIds = staleJobs.map((j) => j.id);
    }

    log(
      `[recovery] complete — scanned=${stats.scanned} recovered=${stats.recovered} ` +
      `requeued=${stats.requeued} skipped=${stats.skipped} errors=${stats.errors.length}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stats.errors.push(`recovery fatal: ${msg}`);
    log(`[recovery] FATAL: ${msg}`);
  }

  return stats;
}

/**
 * Recovery scheduler — periodically invokes recoverStaleJobs().
 *
 * Used by the worker to recover jobs whose workers crashed mid-processing.
 * The scheduler is intentionally simple: setInterval + try/catch so a single
 * failed recovery pass doesn't crash the worker.
 *
 * Returns a stop() function so callers (tests, graceful shutdown) can cancel.
 */
export function startRecoveryScheduler(
  db: PrismaClient,
  intervalMs?: number
): { stop: () => void } {
  const interval =
    intervalMs ??
    parseInt(process.env.RECOVERY_INTERVAL_MS || String(60_000), 10);

  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      await recoverStaleJobs(db, { log: (m) => console.log(m) });
    } catch (err) {
      console.error(
        '[recovery:scheduler] pass failed:',
        err instanceof Error ? err.message : err
      );
    }
  };

  // Run once immediately (catches stale jobs from a previous worker lifecycle).
  tick().catch(() => {});

  const handle = setInterval(tick, interval);
  // Don't keep the process alive solely for the scheduler.
  handle.unref?.();

  return {
    stop: () => {
      stopped = true;
      clearInterval(handle);
    },
  };
}
