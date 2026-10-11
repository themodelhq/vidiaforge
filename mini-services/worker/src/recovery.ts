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

const lib = '../../../lib';

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



export interface RenderRecoveryOptions {
  /** Override the render lease cutoff (default: RENDER_JOB_STALE_AFTER_MS or 3 minutes). */
  leaseMs?: number;
  /** If true, recover the DB row without sending a BullMQ message (tests only). */
  skipRequeue?: boolean;
  /** Optional logger. */
  log?: (msg: string) => void;
}

/**
 * Recover abandoned RenderJobs. The AIJob sweep above cannot recover render
 * rows: they use a different Prisma model, queue, and lease timestamps.
 *
 * Each row is claimed for recovery with an atomic conditional update that
 * includes the observed lease fields. If a live worker refreshes its heartbeat
 * after the scan, the conditional update affects zero rows and recovery skips
 * it. Only successfully transitioned rows are enqueued to BullMQ.
 */
export async function recoverStaleRenderJobs(
  db: PrismaClient,
  options: RenderRecoveryOptions = {}
): Promise<RecoveryStats> {
  const log = options.log ?? ((message: string) => console.log(message));
  const stats: RecoveryStats = {
    scanned: 0,
    recovered: 0,
    requeued: 0,
    skipped: 0,
    errors: [],
    recoveredJobIds: [],
  };
  const leaseMs =
    options.leaseMs ??
    Number.parseInt(process.env.RENDER_JOB_STALE_AFTER_MS || String(3 * 60_000), 10);
  const staleCutoff = new Date(Date.now() - Math.max(1_000, leaseMs));
  const activeStatuses = ['preparing', 'processing', 'encoding', 'uploading'];
  const staleClause = {
    OR: [
      { heartbeatAt: { lt: staleCutoff } },
      { heartbeatAt: { equals: null }, startedAt: { lt: staleCutoff } },
    ],
  };

  try {
    const candidates = await db.renderJob.findMany({
      where: { status: { in: activeStatuses }, ...staleClause },
      select: {
        id: true,
        status: true,
        stage: true,
        progress: true,
        workerId: true,
        attemptId: true,
        heartbeatAt: true,
        startedAt: true,
        completedAt: true,
      },
    });
    stats.scanned = candidates.length;
    log(
      `[render-recovery] scanning RenderJobs — leaseMs=${leaseMs} staleCutoff=${staleCutoff.toISOString()} found=${candidates.length}`
    );

    if (candidates.length === 0) {
      log('[render-recovery] no stale RenderJobs found');
      return stats;
    }

    const { enqueue } = options.skipRequeue
      ? { enqueue: null as null | ((queueName: any, data: unknown) => Promise<any>) }
      : await import(`${lib}/queue`);
    const { QUEUE_NAMES } = options.skipRequeue
      ? { QUEUE_NAMES: { RENDER: 'render' } }
      : await import(`${lib}/queue-names`);

    for (const candidate of candidates) {
      // Match the exact lease observed during the scan. This prevents a stale
      // sweep from taking ownership away from a worker that heartbeated meanwhile.
      const claimed = await db.renderJob.updateMany({
        where: {
          id: candidate.id,
          status: candidate.status,
          workerId: candidate.workerId,
          attemptId: candidate.attemptId,
          heartbeatAt: candidate.heartbeatAt,
          startedAt: candidate.startedAt,
          ...staleClause,
        },
        data: {
          status: 'queued',
          stage: 'queued',
          progress: 0,
          error: 'Render worker lease expired; job re-queued for retry.',
          workerId: null,
          attemptId: null,
          heartbeatAt: null,
          startedAt: null,
          completedAt: null,
        },
      });

      if (claimed.count !== 1) {
        stats.skipped++;
        log(`[render-recovery] skipped ${candidate.id} — lease changed or job is no longer active`);
        continue;
      }
      stats.recovered++;

      if (options.skipRequeue) {
        stats.recoveredJobIds.push(candidate.id);
        continue;
      }

      const enqueued = await enqueue!(QUEUE_NAMES.RENDER, { jobId: candidate.id });
      if (enqueued.ok) {
        stats.requeued++;
        stats.recoveredJobIds.push(candidate.id);
        log(`[render-recovery] requeued RenderJob ${candidate.id} → BullMQ jobId=${enqueued.jobId ?? 'unknown'}`);
        continue;
      }

      const error = `BullMQ requeue failed: ${enqueued.error || 'unknown queue error'}`;
      stats.errors.push(`RenderJob ${candidate.id}: ${error}`);
      log(`[render-recovery] FAILED to requeue RenderJob ${candidate.id}: ${error}`);

      // Restore the stale lease only if no new worker has claimed the row.
      // It remains eligible for a later sweep; never overwrite a live attempt.
      const rollback = await db.renderJob.updateMany({
        where: {
          id: candidate.id,
          status: 'queued',
          workerId: null,
          attemptId: null,
          heartbeatAt: null,
          startedAt: null,
          error: 'Render worker lease expired; job re-queued for retry.',
        },
        data: {
          status: candidate.status,
          stage: candidate.stage,
          progress: candidate.progress,
          error,
          workerId: candidate.workerId,
          attemptId: candidate.attemptId,
          heartbeatAt: candidate.heartbeatAt,
          startedAt: candidate.startedAt,
          completedAt: candidate.completedAt,
        },
      });
      if (rollback.count === 1) {
        // The row was restored to its previous stale state, so it was not
        // successfully recovered for queue processing in this pass.
        stats.recovered--;
      } else {
        stats.skipped++;
        log(`[render-recovery] rollback skipped for ${candidate.id} — another worker changed the row`);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stats.errors.push(`render recovery fatal: ${message}`);
    log(`[render-recovery] FATAL: ${message}`);
  }

  log(
    `[render-recovery] complete — scanned=${stats.scanned} recovered=${stats.recovered} requeued=${stats.requeued} skipped=${stats.skipped} errors=${stats.errors.length}`
  );
  return stats;
}

/**
 * Recovery scheduler — periodically invokes AIJob and RenderJob recovery.
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
      await recoverStaleRenderJobs(db, { log: (m) => console.log(m) });
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
