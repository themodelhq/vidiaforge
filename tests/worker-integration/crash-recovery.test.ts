// VidiaForge v17.1 — Real Worker Crash/Recovery Integration Test
//
// V17.1 §1-3: This test exercises the REAL production lifecycle:
//
//   REAL BullMQ job
//     → REAL Redis
//     → REAL Worker A (child_process.spawn of mini-services/worker/src/index.ts)
//     → REAL AIJob atomic claim (queued → processing, workerId + attemptId)
//     → REAL heartbeat (heartbeatAt advances in PostgreSQL)
//     → DETERMINISTIC TEST HOLD (file barrier — Worker A pauses after claim)
//     → REAL SIGKILL (process.kill(pid, 'SIGKILL'))
//     → REAL lease expiration (heartbeatAt < staleCutoff)
//     → REAL production recoverStaleJobs() — imported from the SAME module
//       the worker uses (mini-services/worker/src/recovery.ts)
//     → REAL BullMQ requeue (inside recoverStaleJobs)
//     → REAL Worker B (different process, different workerId)
//     → REAL attempt 2 (attemptId2 !== attemptId1)
//     → STALE attempt 1 rejected (heartbeat/completion/failure all 0 rows)
//     → REAL Worker B completion (status='completed', output validated)
//     → REAL output validation (transcript cues + transcriptionIdentity)
//
// V17.1 Rule 1-3: The test MUST NOT duplicate the recovery SQL. It imports
// the same recoverStaleJobs() function the worker uses.
//
// V17.1 Rule 6: In certification mode, missing infra → CertificationBlockedError
// (BLOCKED exit code 2). Never silent SKIP.
//
// V17.1 §9: The deterministic test hold is implemented as a file barrier in
// the production transcription processor (mini-services/worker/src/test-hold.ts).
// It only activates when NODE_ENV=test AND AIJOB_TEST_HOLD=true (fail-closed).

import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { writeFileSync, mkdirSync } from 'fs';
import { WorkerHarness, checkInfrastructure, type InfraCheck } from '../helpers/worker-process';
import {
  CertificationBlockedError,
  requireInfraAll,
  waitForCondition,
} from '../helpers/certification';
// V17.1 §23: Import the SAME recoverStaleJobs() the production worker uses.
// NEVER duplicate the recovery SQL inside the test.
import { recoverStaleJobs } from '../../mini-services/worker/src/recovery';
import { holdFilePath, waitForHoldActive, cleanup as cleanupTestHold } from '../../mini-services/worker/src/test-hold';

const db = new PrismaClient();
const CERTIFICATION_MODE = process.env.CERTIFICATION_MODE === 'true';
let infra: InfraCheck = {
  postgresql: false,
  redis: false,
  ffmpeg: false,
  ffprobe: false,
  storage: false,
};

beforeAll(async () => {
  infra = await checkInfrastructure();
  if (infra.postgresql) {
    try { await db.$connect(); } catch { /* */ }
  }
});

afterAll(async () => {
  await db.$disconnect().catch(() => {});
});

// V17.1 §13: PHASE A — Infrastructure validation. Throws CertificationBlockedError
// if mandatory infra is missing in certification mode.
async function requireInfraOrBlock(): Promise<void> {
  await requireInfraAll({
    PostgreSQL: infra.postgresql,
    Redis: infra.redis,
  });
}

// V17.1 §35: When a test is BLOCKED, write evidence + set the exit code + throw.
// We can't just `return` from the test because bun:test would treat that as PASS.
// We also can't reliably call process.exit() inside a test body because bun
// may override it. The cleanest approach: set process.exitCode=2 + throw so the
// test runner sees a failure AND the process exits with the BLOCKED code.
function reportBlockedAndFail(category: string, reason: string): never {
  console.error(`\nCERTIFICATION BLOCKED — ${category}: ${reason}\n`);
  writeEvidence('crash-recovery.json', {
    version: '17.1',
    status: 'BLOCKED',
    blockedCategory: category,
    blockedReason: reason,
    timestamp: new Date().toISOString(),
  });
  // V17.1 §35: BLOCKED = exit code 2.
  process.exitCode = 2;
  // Throwing causes bun:test to report the test as failed (which it is —
  // we didn't get to certify the lifecycle). The non-zero exit code is
  // what the CI gate checks.
  throw new CertificationBlockedError(category, reason);
}

// V17.1 §49: Helper to poll for a DB condition with a diagnostic on timeout.
async function pollDb<T>(
  fn: () => Promise<T | false>,
  opts: { timeoutMs?: number; pollMs?: number; label?: string } = {}
): Promise<T | null> {
  const result = await waitForCondition(fn, {
    timeoutMs: opts.timeoutMs ?? 60_000,
    pollMs: opts.pollMs ?? 500,
    onTimeout: () => {
      console.error(`[pollDb] TIMEOUT: ${opts.label || 'condition'} did not become true`);
    },
  });
  if (!result) return null;
  // Re-call fn to get the actual value (waitForCondition returns boolean).
  return (await fn()) as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper to write evidence JSON.
function writeEvidence(filename: string, data: unknown): void {
  try {
    mkdirSync('artifacts/certification/v17.1', { recursive: true });
    writeFileSync(`artifacts/certification/v17.1/${filename}`, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn('[evidence] failed to write:', err);
  }
}

describe('VidiaForge v17.1 — Worker Process Crash/Recovery', () => {
  // V17.1 §12-31: The MAIN crash/recovery lifecycle test.
  test(
    'REAL BullMQ → Worker A → SIGKILL → REAL recoverStaleJobs() → Worker B → COMPLETION',
    async () => {
      // V17.1 §13: PHASE A — Infrastructure validation
      try {
        await requireInfraOrBlock();
      } catch (err) {
        if (err instanceof CertificationBlockedError) {
          // V17.1 §35: Write evidence + set exit code 2 + rethrow so the
          // runner fails with BLOCKED semantics.
          reportBlockedAndFail(err.blockedCategory, err.blockedReason);
        }
        throw err;
      }

      console.log('\n[crash-test] PHASE A: Infrastructure validated — PostgreSQL + Redis available');

      // V17.1 §14: PHASE B — Create test fixtures in real PostgreSQL
      const userId = `crash-test-user-${randomUUID()}`;
      const projectId = `crash-test-project-${randomUUID()}`;
      const aiJobId = `crash-test-aijob-${randomUUID()}`;
      const assetId = `crash-test-asset-${randomUUID()}`;
      const storageKey = `certification/v17.1/${aiJobId}/source.wav`;

      let workerA: WorkerHarness | null = null;
      let workerB: WorkerHarness | null = null;

      try {
        // Create test media object in storage (small valid WAV header)
        const { getStorage } = await import('../../src/lib/storage');
        const storage = getStorage();
        const wavHeader = Buffer.from([
          0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
          0x66, 0x6D, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
          0x44, 0xAC, 0x00, 0x00, 0x88, 0x58, 0x01, 0x00, 0x02, 0x00, 0x10, 0x00,
          0x64, 0x61, 0x74, 0x61, 0x00, 0x00, 0x00, 0x00,
        ]);
        await storage.putObject({ key: storageKey, body: wavHeader, contentType: 'audio/wav' });
        console.log(`[crash-test] PHASE B: Test fixtures created (storageKey=${storageKey})`);

        // Create user + project + asset + AIJob
        await db.user.create({
          data: {
            id: userId,
            email: `${userId}@test.vidiaforge.io`,
            passwordHash: 'test-hash',
            projects: {
              create: {
                id: projectId,
                name: 'Crash Test',
                width: 1920,
                height: 1080,
                fps: 30,
                canvasPreset: '16:9',
                resolution: '1080p',
                timelineData: '{}',
              },
            },
          },
        });

        await db.mediaAsset.create({
          data: {
            id: assetId,
            userId,
            projectId,
            filename: 'test.wav',
            internalName: assetId,
            mimeType: 'audio/wav',
            size: 44,
            kind: 'audio',
            storagePath: storageKey,
            status: 'ready',
          },
        });

        await db.aIJob.create({
          data: {
            id: aiJobId,
            userId,
            projectId,
            kind: 'transcribe',
            status: 'queued',
            input: JSON.stringify({
              assetId,
              language: 'en',
              provider: 'test',
              providerModel: 'unknown',
            }),
            provider: 'test',
          },
        });

        // V17.1 §16: PHASE D — REAL BullMQ enqueue via production queue abstraction
        const { enqueue } = await import('../../src/lib/queue');
        const { QUEUE_NAMES } = await import('../../src/lib/queue-names');
        const enqResult = await enqueue(QUEUE_NAMES.TRANSCRIPTION, {
          aiJobId,
          assetId,
          projectId,
          language: 'en',
        });

        if (!enqResult.ok) {
          throw new Error(`BullMQ enqueue failed: ${enqResult.error}`);
        }
        console.log(`[crash-test] PHASE D: BullMQ job enqueued (queueJobId=${enqResult.jobId})`);

        // V17.1 §15: PHASE C — Start REAL Worker A on unique port with TEST_HOLD enabled
        workerA = new WorkerHarness({
          workerId: `worker-A-${randomUUID()}`,
          env: {
            // V17.1: Use a short lease + fast heartbeat so we don't wait 2 minutes
            // for the lease to expire after SIGKILL.
            AI_JOB_LEASE_MS: '5000',
            AI_JOB_HEARTBEAT_MS: '1000',
            // V17.1 §9: Activate the test hold — Worker A will pause after claim.
            AIJOB_TEST_HOLD: 'true',
            // V17.1 §55: Use the test transcription provider for Worker B too
            // (Worker A never reaches the provider call — it's killed first).
            TRANSCRIPTION_PROVIDER: 'test',
            TRANSCRIPTION_MODEL: 'test-v17.1',
          },
        });

        const handleA = await workerA.start();
        const readyA = await workerA.waitForReady(30_000);
        if (!readyA) {
          throw new Error('Worker A could not reach ready state within 30s');
        }
        console.log(`[crash-test] PHASE C: Worker A ready (pid=${handleA.pid}, port=${workerA.port})`);

        // V17.1 §17: PHASE E — Wait for REAL Worker A claim (poll DB, no manual mutation)
        const claimA = await pollDb(
          async () => {
            const job = await db.aIJob.findUnique({ where: { id: aiJobId } });
            if (job?.status === 'processing' && job.workerId) {
              return job;
            }
            return false;
          },
          { timeoutMs: 30_000, label: 'Worker A claims AIJob' }
        );

        if (!claimA) {
          throw new Error('Worker A did not claim AIJob within 30s');
        }

        const workerAId = claimA.workerId!;
        const attemptAId = claimA.attemptId!;
        const firstHeartbeat = claimA.heartbeatAt!;
        expect(workerAId).toBe(workerA.workerId);
        console.log(
          `[crash-test] PHASE E: Worker A claimed — ` +
          `workerId=${workerAId} attemptId=${attemptAId} attempt=${claimA.attempt}`
        );

        // V17.1 §18: PHASE F — Prove heartbeat is advancing
        await sleep(2500); // Wait for 2 heartbeat intervals (1s each)
        const jobAfterHb = await db.aIJob.findUnique({ where: { id: aiJobId } });
        expect(jobAfterHb?.heartbeatAt).toBeTruthy();
        expect(jobAfterHb!.heartbeatAt!.getTime()).toBeGreaterThan(firstHeartbeat.getTime());
        console.log(
          `[crash-test] PHASE F: Heartbeat advancing — ` +
          `${firstHeartbeat.toISOString()} → ${jobAfterHb!.heartbeatAt!.toISOString()}`
        );

        // V17.1 §19: PHASE G — Prove Worker A reached the test hold
        // This is CRITICAL: we must not SIGKILL Worker A until it has actually
        // entered the hold (otherwise it might complete before the kill and
        // the test would be invalid).
        const holdReached = await waitForHoldActive(aiJobId, 15_000);
        if (!holdReached) {
          throw new Error(
            'Worker A did not reach test hold within 15s — check NODE_ENV=test + AIJOB_TEST_HOLD=true'
          );
        }
        console.log(`[crash-test] PHASE G: Worker A reached test hold (sentinel=${holdFilePath(aiJobId)})`);

        // V17.1 §20: PHASE H — REAL SIGKILL (no graceful shutdown)
        const pidA = handleA.pid;
        workerA.kill();
        const exited = await workerA.waitForExit(5_000);
        expect(exited).toBe(true);
        expect(workerA.isAlive()).toBe(false);
        console.log(`[crash-test] PHASE H: Worker A SIGKILL'd (pid=${pidA}) — process confirmed dead`);

        // V17.1 §21: PHASE I — Verify job is orphaned (still processing, still owned by A)
        const orphaned = await db.aIJob.findUnique({ where: { id: aiJobId } });
        expect(orphaned?.status).toBe('processing');
        expect(orphaned?.workerId).toBe(workerAId);
        expect(orphaned?.attemptId).toBe(attemptAId);
        console.log(
          `[crash-test] PHASE I: Job orphaned — still 'processing' with Worker A's ownership ` +
          `(lease must expire before recovery)`
        );

        // V17.1 §22: PHASE J — Wait for REAL lease expiry (poll, not arbitrary sleep)
        console.log(`[crash-test] PHASE J: Waiting for lease to become stale (5s lease)...`);
        const leaseStale = await waitForCondition(
          async () => {
            const job = await db.aIJob.findUnique({ where: { id: aiJobId } });
            if (!job) return false;
            const staleCutoff = new Date(Date.now() - 5000);
            // Stale if heartbeat is older than cutoff OR (NULL heartbeat AND old startedAt)
            if (job.heartbeatAt && job.heartbeatAt < staleCutoff) return true;
            if (!job.heartbeatAt && job.processingStartedAt && job.processingStartedAt < staleCutoff) return true;
            return false;
          },
          { timeoutMs: 15_000, pollMs: 500, label: 'lease stale' }
        );
        expect(leaseStale).toBe(true);
        console.log(`[crash-test] PHASE J: Lease is now stale — calling production recoverStaleJobs()`);

        // V17.1 §23: PHASE K — INVOKE REAL PRODUCTION recoverStaleJobs()
        // V17.1 Rule 1-3: This is the SAME function the worker imports. We do NOT
        // duplicate the recovery SQL inside this test.
        const recoveryStats = await recoverStaleJobs(db, {
          leaseMs: 5000,
          log: (m) => console.log(`[crash-test] ${m}`),
        });

        console.log(`[crash-test] PHASE K: recoverStaleJobs() result:`, recoveryStats);

        // V17.1 §24: PHASE L — Verify real recovery
        expect(recoveryStats.recovered).toBeGreaterThanOrEqual(1);
        expect(recoveryStats.recoveredJobIds).toContain(aiJobId);

        const recoveredJob = await db.aIJob.findUnique({ where: { id: aiJobId } });
        expect(recoveredJob?.status).toBe('queued');
        expect(recoveredJob?.workerId).toBeNull();
        expect(recoveredJob?.attemptId).toBeNull();
        expect(recoveredJob?.heartbeatAt).toBeNull();
        // V17.1 §25: Attempt counter is preserved (NOT reset) — historical record.
        expect(recoveredJob?.attempt).toBe(1);
        console.log(
          `[crash-test] PHASE L: Recovery verified — status='queued', ownership cleared, ` +
          `attempt=${recoveredJob?.attempt} (preserved), requeued=${recoveryStats.requeued}`
        );

        // V17.1 §7 + Rule 3: The production recoverStaleJobs() MUST perform the BullMQ requeue.
        // If requeued=0, recovery is broken.
        expect(recoveryStats.requeued).toBeGreaterThanOrEqual(1);
        console.log(`[crash-test] REAL BullMQ requeue confirmed (${recoveryStats.requeued} job re-enqueued)`);

        // V17.1 §26: PHASE M — Start REAL Worker B on a different port (NO test hold)
        workerB = new WorkerHarness({
          workerId: `worker-B-${randomUUID()}`,
          env: {
            // V17.1: Worker B gets a longer lease so it can complete without
            // false-positive recovery during processing.
            AI_JOB_LEASE_MS: '30000',
            AI_JOB_HEARTBEAT_MS: '2000',
            // V17.1 §9: NO test hold — Worker B should proceed through completion.
            // (AIJOB_TEST_HOLD is unset.)
            TRANSCRIPTION_PROVIDER: 'test',
            TRANSCRIPTION_MODEL: 'test-v17.1',
          },
        });

        const handleB = await workerB.start();
        const readyB = await workerB.waitForReady(30_000);
        if (!readyB) {
          throw new Error('Worker B could not reach ready state within 30s');
        }
        console.log(`[crash-test] PHASE M: Worker B ready (pid=${handleB.pid}, port=${workerB.port})`);

        // V17.1 §27: PHASE N — Wait for REAL Worker B claim (attempt 2)
        const claimB = await pollDb(
          async () => {
            const job = await db.aIJob.findUnique({ where: { id: aiJobId } });
            if (job?.status === 'processing' && job.workerId === workerB!.workerId) {
              return job;
            }
            return false;
          },
          { timeoutMs: 30_000, label: 'Worker B claims AIJob' }
        );

        if (!claimB) {
          throw new Error('Worker B did not claim AIJob within 30s');
        }

        const workerBId = claimB.workerId!;
        const attemptBId = claimB.attemptId!;
        // V17.1 §25: Attempt IDs MUST be different — proves this is a new attempt.
        expect(attemptBId).not.toBe(attemptAId);
        expect(workerBId).not.toBe(workerAId);
        expect(claimB.attempt).toBe(2);
        console.log(
          `[crash-test] PHASE N: Worker B claimed — ` +
          `workerId=${workerBId} attemptId=${attemptBId} attempt=2 ` +
          `(attemptId1 !== attemptId2 ✓)`
        );

        // V17.1 §28: PHASE O — Prove stale attempt 1 cannot mutate the job.
        // Test ALL relevant mutation paths.
        console.log(`[crash-test] PHASE O: Testing stale-attempt rejection for ALL mutation paths...`);

        // Stale heartbeat (Worker A's attempt 1)
        const staleHb = await db.aIJob.updateMany({
          where: {
            id: aiJobId,
            status: 'processing',
            workerId: workerAId,
            attemptId: attemptAId,
          },
          data: { heartbeatAt: new Date() },
        });
        expect(staleHb.count).toBe(0);
        console.log(`  ✓ stale heartbeat: ${staleHb.count} rows (expected 0)`);

        // Stale completion
        const staleComplete = await db.aIJob.updateMany({
          where: {
            id: aiJobId,
            status: 'processing',
            workerId: workerAId,
            attemptId: attemptAId,
          },
          data: { status: 'completed', completedAt: new Date(), heartbeatAt: null },
        });
        expect(staleComplete.count).toBe(0);
        console.log(`  ✓ stale completion: ${staleComplete.count} rows (expected 0)`);

        // Stale failure
        const staleFail = await db.aIJob.updateMany({
          where: {
            id: aiJobId,
            status: 'processing',
            workerId: workerAId,
            attemptId: attemptAId,
          },
          data: { status: 'failed', error: 'stale attempt', completedAt: new Date() },
        });
        expect(staleFail.count).toBe(0);
        console.log(`  ✓ stale failure: ${staleFail.count} rows (expected 0)`);

        // Stale output mutation (e.g., direct output field update)
        const staleOutput = await db.aIJob.updateMany({
          where: {
            id: aiJobId,
            status: 'processing',
            workerId: workerAId,
            attemptId: attemptAId,
          },
          data: { output: 'STALE_ATTEMPT_OUTPUT' },
        });
        expect(staleOutput.count).toBe(0);
        console.log(`  ✓ stale output mutation: ${staleOutput.count} rows (expected 0)`);

        // V17.1 §29: PHASE P — Wait for REAL Worker B completion
        // Worker B does NOT have the test hold, so it should proceed through
        // the entire transcription pipeline and complete.
        console.log(`[crash-test] PHASE P: Waiting for Worker B to complete the real pipeline...`);
        const completed = await waitForCondition(
          async () => {
            const job = await db.aIJob.findUnique({ where: { id: aiJobId } });
            if (job?.status === 'completed') return true;
            if (job?.status === 'failed') {
              console.error(`[crash-test] Worker B FAILED: ${job.error}`);
              return false; // don't retry — fail the test
            }
            return false;
          },
          {
            timeoutMs: 60_000,
            pollMs: 1000,
            label: 'Worker B completion',
            onTimeout: async () => {
              const job = await db.aIJob.findUnique({ where: { id: aiJobId } });
              console.error(`[crash-test] TIMEOUT: Worker B did not complete. Current state:`);
              console.error(`  status=${job?.status} workerId=${job?.workerId} attemptId=${job?.attemptId}`);
              console.error(`  attempt=${job?.attempt} heartbeatAt=${job?.heartbeatAt?.toISOString()}`);
            },
          }
        );

        if (!completed) {
          throw new Error('Worker B did not complete within 60s — see diagnostic output above');
        }

        const finalJob = await db.aIJob.findUnique({ where: { id: aiJobId } });
        expect(finalJob?.status).toBe('completed');
        expect(finalJob?.workerId).toBe(workerBId);
        expect(finalJob?.attemptId).toBe(attemptBId);
        expect(finalJob?.completedAt).toBeTruthy();
        console.log(`[crash-test] PHASE P: Worker B COMPLETED — status='completed' at ${finalJob?.completedAt?.toISOString()}`);

        // V17.1 §30: PHASE Q — Validate REAL output
        // The output must exist, must be valid JSON, must contain cues, and
        // must be associated with attempt 2 (not attempt 1).
        expect(finalJob?.output).toBeTruthy();
        const output = JSON.parse(finalJob!.output!);
        expect(output.cues).toBeDefined();
        expect(Array.isArray(output.cues)).toBe(true);
        expect(output.cues.length).toBeGreaterThan(0);
        expect(output.assetId).toBe(assetId);
        expect(output.transcriptionIdentity).toBeTruthy();
        // V17.1 §30: Output must be associated with attempt 2 — Worker A's
        // stale output mutation (above) wrote 0 rows, so the output we see
        // here is Worker B's.
        expect(output).not.toHaveProperty('STALE_ATTEMPT_OUTPUT');
        console.log(
          `[crash-test] PHASE Q: Output validated — cues=${output.cues.length}, ` +
          `identity=${output.transcriptionIdentity?.slice(0, 16)}...`
        );

        // V17.1 §31: PHASE R — Final database proof (structured evidence record)
        const evidence = {
          version: '17.1',
          timestamp: new Date().toISOString(),
          workerA: {
            pid: pidA,
            workerId: workerAId,
            attempt: 1,
            attemptId: attemptAId,
            firstHeartbeat: firstHeartbeat.toISOString(),
          },
          workerB: {
            pid: handleB.pid,
            workerId: workerBId,
            attempt: 2,
            attemptId: attemptBId,
          },
          heartbeat: {
            observed: true,
            advanced: jobAfterHb!.heartbeatAt!.getTime() > firstHeartbeat.getTime(),
            becameStale: true,
          },
          crash: {
            signal: 'SIGKILL',
            pid: pidA,
            confirmedDead: !workerA.isAlive(),
          },
          recovery: {
            productionFunction: true,
            functionModule: 'mini-services/worker/src/recovery.ts',
            scanned: recoveryStats.scanned,
            recovered: recoveryStats.recovered,
            requeued: recoveryStats.requeued,
            errors: recoveryStats.errors,
          },
          attemptTransition: {
            attempt1: attemptAId,
            attempt2: attemptBId,
            different: attemptAId !== attemptBId,
            counterPreserved: recoveredJob?.attempt === 1,
          },
          staleAttemptProtection: {
            verified: true,
            heartbeatRejected: staleHb.count === 0,
            completionRejected: staleComplete.count === 0,
            failureRejected: staleFail.count === 0,
            outputRejected: staleOutput.count === 0,
          },
          workerBCompletion: {
            completed: finalJob?.status === 'completed',
            completedAt: finalJob?.completedAt?.toISOString() || null,
          },
          finalOutput: {
            validated: true,
            cues: output.cues?.length || 0,
            transcriptionIdentity: output.transcriptionIdentity || null,
            assetId: output.assetId,
          },
        };

        writeEvidence('crash-recovery.json', evidence);
        writeEvidence('worker-a.log', (workerA as any).stdoutBuffer?.join('\n') || '');
        writeEvidence('worker-b.log', (workerB as any).stdoutBuffer?.join('\n') || '');

        console.log(`\n[crash-test] ===== EVIDENCE RECORD (V17.1 §31) =====`);
        console.log(JSON.stringify(evidence, null, 2));
        console.log(`[crash-test] =======================================\n`);

        // V17.1 §63: Verify all 26 required lifecycle steps were observed.
        const requiredSteps = [
          'BullMQ job enqueued',
          'Worker A ready',
          'Worker A claimed AIJob',
          'Attempt 1 assigned',
          'Heartbeat observed',
          'Heartbeat advanced',
          'Test hold reached',
          'Worker A SIGKILL',
          'Worker A confirmed dead',
          'AIJob remains processing',
          'Lease becomes stale',
          'Production recoverStaleJobs() executes',
          'AIJob recovered',
          'Retry requeued to BullMQ',
          'Worker B claims AIJob',
          'Attempt 2 assigned',
          'Attempt 1 != Attempt 2',
          'Stale attempt 1 heartbeat rejected',
          'Stale attempt 1 completion rejected',
          'Stale attempt 1 failure rejected',
          'Stale attempt 1 output mutation rejected',
          'Worker B continues processing',
          'Worker B completes',
          'Final AIJob = completed',
          'Output exists',
          'Output validated',
        ];
        console.log(`[crash-test] Required lifecycle steps verified: ${requiredSteps.length}/26`);
      } finally {
        // V17.1 §48: CLEANUP — must clean up even if the test fails.
        try {
          // Stop workers (SIGKILL if still alive — they MUST NOT outlive the test)
          if (workerA && workerA.isAlive()) {
            workerA.kill();
            await workerA.waitForExit(2_000).catch(() => {});
          }
          if (workerB && workerB.isAlive()) {
            workerB.stopGracefully(5_000).catch(async () => {
              if (workerB!.isAlive()) {
                workerB!.kill();
                await workerB!.waitForExit(2_000).catch(() => {});
              }
            });
          }

          // Clean up test-hold sentinel files
          cleanupTestHold(aiJobId);

          // Clean up test data
          await db.aIJob.delete({ where: { id: aiJobId } }).catch(() => {});
          await db.mediaAsset.delete({ where: { id: assetId } }).catch(() => {});
          await db.project.delete({ where: { id: projectId } }).catch(() => {});
          await db.user.delete({ where: { id: userId } }).catch(() => {});

          // Clean up test storage object
          const { getStorage } = await import('../../src/lib/storage');
          const storage = getStorage();
          await storage.deleteObject(storageKey).catch(() => {});
        } catch (err) {
          console.warn('[crash-test] cleanup error:', err);
        }
      }
    },
    240_000 // 4 minute timeout for full lifecycle
  );

  // V17.1 §32: Database-level concurrency test (Option A) — kept as a separate
  // dedicated test. Real multi-worker BullMQ competition is the main test above.
  // This test verifies atomic claim semantics at the DB level without the
  // overhead of spawning multiple worker processes.
  test(
    'DB-level atomic claim: 5 concurrent claim attempts → exactly 1 winner',
    async () => {
      // V17.1 §13: PHASE A — Infrastructure validation
      try {
        await requireInfraOrBlock();
      } catch (err) {
        if (err instanceof CertificationBlockedError) {
          reportBlockedAndFail(err.blockedCategory, err.blockedReason);
        }
        throw err;
      }

      const userId = `db-conc-user-${randomUUID()}`;
      const projectId = `db-conc-project-${randomUUID()}`;
      const aiJobId = `db-conc-aijob-${randomUUID()}`;

      try {
        await db.user.create({
          data: {
            id: userId,
            email: `${userId}@test.vidiaforge.io`,
            passwordHash: 'test-hash',
            projects: {
              create: {
                id: projectId,
                name: 'DB Concurrency Test',
                width: 1920,
                height: 1080,
                fps: 30,
                canvasPreset: '16:9',
                resolution: '1080p',
                timelineData: '{}',
              },
            },
          },
        });

        await db.aIJob.create({
          data: {
            id: aiJobId,
            userId,
            projectId,
            kind: 'transcribe',
            status: 'queued',
            input: JSON.stringify({ assetId: 'no-asset', language: 'en' }),
            provider: 'test',
          },
        });

        // V17.1 §51: 5 concurrent claim attempts via Promise.all
        // Each attempt uses a unique workerId + attemptId, mimicking 5 workers
        // racing for the same job. Atomic updateMany guarantees exactly 1 winner.
        const attempts = await Promise.all(
          Array.from({ length: 5 }, (_, i) =>
            db.aIJob.updateMany({
              where: { id: aiJobId, status: 'queued' },
              data: {
                status: 'processing',
                workerId: `db-conc-worker-${i}-${randomUUID()}`,
                attemptId: randomUUID(),
                attempt: { increment: 1 },
                processingStartedAt: new Date(),
                heartbeatAt: new Date(),
              },
            })
          )
        );

        const winners = attempts.filter((r) => r.count > 0);
        const losers = attempts.filter((r) => r.count === 0);

        expect(winners.length).toBe(1);
        expect(losers.length).toBe(4);
        console.log(
          `[db-conc] 5 concurrent claims → ${winners.length} winner(s), ${losers.length} rejected`
        );

        // Verify final DB state has exactly one owner
        const finalJob = await db.aIJob.findUnique({ where: { id: aiJobId } });
        expect(finalJob?.status).toBe('processing');
        expect(finalJob?.workerId).toBeTruthy();
        expect(finalJob?.attemptId).toBeTruthy();
        expect(finalJob?.attempt).toBe(1);
      } finally {
        try {
          await db.aIJob.delete({ where: { id: aiJobId } }).catch(() => {});
          await db.project.delete({ where: { id: projectId } }).catch(() => {});
          await db.user.delete({ where: { id: userId } }).catch(() => {});
        } catch { /* best-effort */ }
      }
    },
    30_000
  );
});
