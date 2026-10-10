// VidiaForge v17.1 — AIJob Concurrency Certification Tests
//
// V14.1 FIX: Tests use Promise.all for REAL concurrent execution.
// V17.1: Uses CertificationBlockedError for hard-failure semantics (no silent SKIP).
//
// In certification mode (CERTIFICATION_MODE=true), unavailable infrastructure
// produces BLOCKED (exit 2), not SKIP. In development mode, SKIP is acceptable.

import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { CertificationBlockedError, getTestMode } from '../helpers/certification';

const db = new PrismaClient();
const CERTIFICATION_MODE = process.env.CERTIFICATION_MODE === 'true';
let pgAvailable = false;

beforeAll(async () => {
  try {
    await db.$connect();
    await db.user.count();
    pgAvailable = true;
  } catch {
    pgAvailable = false;
  }
});

afterAll(async () => {
  await db.$disconnect().catch(() => {});
});

async function createTestAIJob(): Promise<{ aiJobId: string; userId: string; projectId: string }> {
  const userId = `test-user-${randomUUID()}`;
  const projectId = `test-project-${randomUUID()}`;
  const aiJobId = `test-aijob-${randomUUID()}`;

  await db.user.create({
    data: {
      id: userId,
      email: `${userId}@test.vidiaforge.io`,
      passwordHash: 'test-hash',
      projects: { create: { id: projectId, name: 'Test', width: 1920, height: 1080, fps: 30, canvasPreset: '16:9', resolution: '1080p', timelineData: '{}' } },
    },
  });
  await db.aIJob.create({
    data: { id: aiJobId, userId, projectId, kind: 'transcribe', status: 'queued', input: JSON.stringify({ assetId: 'test-asset', language: 'en' }), provider: 'test' },
  });
  return { aiJobId, userId, projectId };
}

async function cleanupTest(userId: string, projectId: string, aiJobId: string) {
  try {
    await db.aIJob.delete({ where: { id: aiJobId } }).catch(() => {});
    await db.project.delete({ where: { id: projectId } }).catch(() => {});
    await db.user.delete({ where: { id: userId } }).catch(() => {});
  } catch { /* best-effort */ }
}

// V17.1 §36: Returns true if the test should be skipped (development mode).
// Throws CertificationBlockedError in certification mode. In production mode
// throws a regular Error (FAIL).
function skipIfNoPg(testName: string): boolean {
  if (pgAvailable) return false;

  const mode = getTestMode();
  if (mode === 'development') {
    console.log(`SKIP: No PostgreSQL for ${testName} (development mode)`);
    return true;
  }
  if (mode === 'certification') {
    throw new CertificationBlockedError('PostgreSQL', 'PostgreSQL is not available for AIJob concurrency certification');
  }
  // production
  throw new Error(`FAIL: PostgreSQL unavailable for ${testName} in production mode`);
}

describe('AIJob Concurrency Certification', () => {
  // V14.1 §3-4: REAL CONCURRENT claim test using Promise.all
  test('concurrent claim — two workers via Promise.all, exactly one wins', async () => {
    if (skipIfNoPg('concurrent claim')) return;

    const { aiJobId, userId, projectId } = await createTestAIJob();
    try {
      const workerA = `worker-A-${randomUUID()}`;
      const attemptA = randomUUID();
      const workerB = `worker-B-${randomUUID()}`;
      const attemptB = randomUUID();

      // V14.1: Execute BOTH claims CONCURRENTLY via Promise.all
      const [claimA, claimB] = await Promise.all([
        db.aIJob.updateMany({
          where: { id: aiJobId, status: 'queued' },
          data: { status: 'processing', workerId: workerA, attemptId: attemptA, attempt: { increment: 1 }, processingStartedAt: new Date(), heartbeatAt: new Date() },
        }),
        db.aIJob.updateMany({
          where: { id: aiJobId, status: 'queued' },
          data: { status: 'processing', workerId: workerB, attemptId: attemptB, attempt: { increment: 1 }, processingStartedAt: new Date(), heartbeatAt: new Date() },
        }),
      ]);

      // Exactly one must succeed
      expect(claimA.count + claimB.count).toBe(1);

      // Verify the winner owns the job
      const job = await db.aIJob.findUnique({ where: { id: aiJobId } });
      expect(job?.status).toBe('processing');
      expect(job?.attempt).toBe(1);
      expect([workerA, workerB]).toContain(job?.workerId);
      expect(job?.heartbeatAt).toBeTruthy();
      expect(job?.processingStartedAt).toBeTruthy();
    } finally {
      await cleanupTest(userId, projectId, aiJobId);
    }
  });

  // V14.1 §5: Many-worker concurrent claim
  test('concurrent claim — 5 workers via Promise.all, exactly one wins', async () => {
    if (skipIfNoPg('5-worker claim')) return;

    const { aiJobId, userId, projectId } = await createTestAIJob();
    try {
      const workers = Array.from({ length: 5 }, (_, i) => ({
        workerId: `worker-${i}-${randomUUID()}`,
        attemptId: randomUUID(),
      }));

      const results = await Promise.all(
        workers.map(w =>
          db.aIJob.updateMany({
            where: { id: aiJobId, status: 'queued' },
            data: { status: 'processing', workerId: w.workerId, attemptId: w.attemptId, attempt: { increment: 1 }, processingStartedAt: new Date(), heartbeatAt: new Date() },
          })
        )
      );

      const totalWins = results.reduce((sum, r) => sum + r.count, 0);
      expect(totalWins).toBe(1);

      const job = await db.aIJob.findUnique({ where: { id: aiJobId } });
      expect(job?.status).toBe('processing');
      expect(job?.attempt).toBe(1);
    } finally {
      await cleanupTest(userId, projectId, aiJobId);
    }
  });

  // V14.1 §2: Attempt identity
  test('after claim, database has correct ownership fields', async () => {
    if (skipIfNoPg('attempt identity')) return;

    const { aiJobId, userId, projectId } = await createTestAIJob();
    try {
      const workerId = `worker-${randomUUID()}`;
      const attemptId = randomUUID();

      await db.aIJob.updateMany({
        where: { id: aiJobId, status: 'queued' },
        data: { status: 'processing', workerId, attemptId, attempt: { increment: 1 }, processingStartedAt: new Date(), heartbeatAt: new Date() },
      });

      const job = await db.aIJob.findUnique({ where: { id: aiJobId } });
      expect(job?.status).toBe('processing');
      expect(job?.workerId).toBe(workerId);
      expect(job?.attemptId).toBe(attemptId);
      expect(job?.attempt).toBe(1);
      expect(job?.heartbeatAt).toBeTruthy();
      expect(job?.processingStartedAt).toBeTruthy();
    } finally {
      await cleanupTest(userId, projectId, aiJobId);
    }
  });

  // V14.1 §8: Heartbeat ownership
  test('heartbeat from non-owner returns 0 rows', async () => {
    if (skipIfNoPg('heartbeat ownership')) return;

    const { aiJobId, userId, projectId } = await createTestAIJob();
    try {
      const workerA = `worker-A-${randomUUID()}`;
      const attemptA = randomUUID();
      const workerB = `worker-B-${randomUUID()}`;

      await db.aIJob.updateMany({
        where: { id: aiJobId, status: 'queued' },
        data: { status: 'processing', workerId: workerA, attemptId: attemptA, attempt: { increment: 1 }, heartbeatAt: new Date(), processingStartedAt: new Date() },
      });

      // Worker B heartbeat (wrong workerId)
      const hbB = await db.aIJob.updateMany({
        where: { id: aiJobId, status: 'processing', workerId: workerB, attemptId: attemptA },
        data: { heartbeatAt: new Date() },
      });
      expect(hbB.count).toBe(0);

      // Worker A heartbeat (correct)
      const hbA = await db.aIJob.updateMany({
        where: { id: aiJobId, status: 'processing', workerId: workerA, attemptId: attemptA },
        data: { heartbeatAt: new Date() },
      });
      expect(hbA.count).toBe(1);
    } finally {
      await cleanupTest(userId, projectId, aiJobId);
    }
  });

  // V14.1 §6: Worker crash/recovery lifecycle
  test('crash recovery: claim → stale → re-queue → new claim → stale worker rejected', async () => {
    if (skipIfNoPg('crash recovery')) return;

    const { aiJobId, userId, projectId } = await createTestAIJob();
    try {
      const workerA = `worker-A-${randomUUID()}`;
      const attemptA = randomUUID();

      // 1. Worker A claims attempt 1
      await db.aIJob.updateMany({
        where: { id: aiJobId, status: 'queued' },
        data: { status: 'processing', workerId: workerA, attemptId: attemptA, attempt: { increment: 1 }, heartbeatAt: new Date(Date.now() - 999999), processingStartedAt: new Date(Date.now() - 999999) },
      });

      // 2. Recovery: stale → queued
      const recovery = await db.aIJob.updateMany({
        where: { id: aiJobId, status: 'processing', heartbeatAt: { lt: new Date(Date.now() - 120000) } },
        data: { status: 'queued', workerId: null, attemptId: null, heartbeatAt: null, error: 'lease expired' },
      });
      expect(recovery.count).toBe(1);

      // 3. Worker B claims attempt 2
      const workerB = `worker-B-${randomUUID()}`;
      const attemptB = randomUUID();
      const claimB = await db.aIJob.updateMany({
        where: { id: aiJobId, status: 'queued' },
        data: { status: 'processing', workerId: workerB, attemptId: attemptB, attempt: { increment: 1 }, heartbeatAt: new Date(), processingStartedAt: new Date() },
      });
      expect(claimB.count).toBe(1);

      // 4. Worker A stale heartbeat → 0 rows
      const staleHb = await db.aIJob.updateMany({
        where: { id: aiJobId, status: 'processing', workerId: workerA, attemptId: attemptA },
        data: { heartbeatAt: new Date() },
      });
      expect(staleHb.count).toBe(0);

      // 5. Worker A stale complete → 0 rows
      const staleComplete = await db.aIJob.updateMany({
        where: { id: aiJobId, status: 'processing', workerId: workerA, attemptId: attemptA },
        data: { status: 'completed', completedAt: new Date(), heartbeatAt: null },
      });
      expect(staleComplete.count).toBe(0);

      // 6. Worker A stale fail → 0 rows
      const staleFail = await db.aIJob.updateMany({
        where: { id: aiJobId, status: 'processing', workerId: workerA, attemptId: attemptA },
        data: { status: 'failed', error: 'stale', completedAt: new Date() },
      });
      expect(staleFail.count).toBe(0);

      // 7. Worker B valid complete → 1 row
      const validComplete = await db.aIJob.updateMany({
        where: { id: aiJobId, status: 'processing', workerId: workerB, attemptId: attemptB },
        data: { status: 'completed', completedAt: new Date(), heartbeatAt: null },
      });
      expect(validComplete.count).toBe(1);

      // 8. Verify final state
      const job = await db.aIJob.findUnique({ where: { id: aiJobId } });
      expect(job?.status).toBe('completed');
      expect(job?.attempt).toBe(2);
    } finally {
      await cleanupTest(userId, projectId, aiJobId);
    }
  });

  // V14.1 §35: Recovery race — concurrent
  test('concurrent recovery — two recoveries via Promise.all, exactly one wins', async () => {
    if (skipIfNoPg('recovery race')) return;

    const { aiJobId, userId, projectId } = await createTestAIJob();
    try {
      const workerA = `worker-A-${randomUUID()}`;
      const attemptA = randomUUID();

      await db.aIJob.updateMany({
        where: { id: aiJobId, status: 'queued' },
        data: { status: 'processing', workerId: workerA, attemptId: attemptA, attempt: { increment: 1 }, heartbeatAt: new Date(Date.now() - 999999), processingStartedAt: new Date(Date.now() - 999999) },
      });

      // V14.1: Execute BOTH recoveries CONCURRENTLY
      const [recovery1, recovery2] = await Promise.all([
        db.aIJob.updateMany({
          where: { id: aiJobId, status: 'processing', heartbeatAt: { lt: new Date(Date.now() - 120000) } },
          data: { status: 'queued', workerId: null, attemptId: null, heartbeatAt: null, error: 'recovery 1' },
        }),
        db.aIJob.updateMany({
          where: { id: aiJobId, status: 'processing', heartbeatAt: { lt: new Date(Date.now() - 120000) } },
          data: { status: 'queued', workerId: null, attemptId: null, heartbeatAt: null, error: 'recovery 2' },
        }),
      ]);

      expect(recovery1.count + recovery2.count).toBe(1);
    } finally {
      await cleanupTest(userId, projectId, aiJobId);
    }
  });

  // V14.1 §37: NULL heartbeat tests — correct processingStartedAt-based logic
  test('NULL heartbeat + OLD processingStartedAt → RECOVERABLE', async () => {
    if (skipIfNoPg('NULL heartbeat old')) return;

    const { aiJobId, userId, projectId } = await createTestAIJob();
    try {
      await db.aIJob.updateMany({
        where: { id: aiJobId, status: 'queued' },
        data: {
          status: 'processing', workerId: `worker-${randomUUID()}`, attemptId: randomUUID(),
          attempt: { increment: 1 }, heartbeatAt: null,
          processingStartedAt: new Date(Date.now() - 999999), // OLD
        },
      });

      // V14.1: NULL heartbeat + old processingStartedAt → stale
      const recovery = await db.aIJob.updateMany({
        where: {
          id: aiJobId, status: 'processing',
          OR: [
            { heartbeatAt: { lt: new Date(Date.now() - 120000) } },
            { heartbeatAt: { equals: null }, processingStartedAt: { lt: new Date(Date.now() - 120000) } },
          ],
        },
        data: { status: 'queued', workerId: null, attemptId: null, heartbeatAt: null, error: 'NULL heartbeat recovery' },
      });
      expect(recovery.count).toBe(1);
    } finally {
      await cleanupTest(userId, projectId, aiJobId);
    }
  });

  // V14.1 §37: NULL heartbeat + RECENT processingStartedAt → NOT recoverable
  test('NULL heartbeat + RECENT processingStartedAt → NOT recovered', async () => {
    if (skipIfNoPg('NULL heartbeat recent')) return;

    const { aiJobId, userId, projectId } = await createTestAIJob();
    try {
      await db.aIJob.updateMany({
        where: { id: aiJobId, status: 'queued' },
        data: {
          status: 'processing', workerId: `worker-${randomUUID()}`, attemptId: randomUUID(),
          attempt: { increment: 1 }, heartbeatAt: null,
          processingStartedAt: new Date(), // RECENT — just started
        },
      });

      // V14.1: NULL heartbeat + recent processingStartedAt → NOT stale
      const recovery = await db.aIJob.updateMany({
        where: {
          id: aiJobId, status: 'processing',
          OR: [
            { heartbeatAt: { lt: new Date(Date.now() - 120000) } },
            { heartbeatAt: { equals: null }, processingStartedAt: { lt: new Date(Date.now() - 120000) } },
          ],
        },
        data: { status: 'queued', workerId: null, attemptId: null, heartbeatAt: null, error: 'should not happen' },
      });
      // Must be 0 — the job is NOT stale because processingStartedAt is recent
      expect(recovery.count).toBe(0);

      // Verify the job remains processing
      const job = await db.aIJob.findUnique({ where: { id: aiJobId } });
      expect(job?.status).toBe('processing');
    } finally {
      await cleanupTest(userId, projectId, aiJobId);
    }
  });

  // V14.1 §37: Old heartbeat → RECOVERABLE
  test('old heartbeat → RECOVERABLE', async () => {
    if (skipIfNoPg('old heartbeat')) return;

    const { aiJobId, userId, projectId } = await createTestAIJob();
    try {
      await db.aIJob.updateMany({
        where: { id: aiJobId, status: 'queued' },
        data: {
          status: 'processing', workerId: `worker-${randomUUID()}`, attemptId: randomUUID(),
          attempt: { increment: 1 },
          heartbeatAt: new Date(Date.now() - 999999), // OLD heartbeat
          processingStartedAt: new Date(Date.now() - 999999),
        },
      });

      const recovery = await db.aIJob.updateMany({
        where: {
          id: aiJobId, status: 'processing',
          OR: [
            { heartbeatAt: { lt: new Date(Date.now() - 120000) } },
            { heartbeatAt: { equals: null }, processingStartedAt: { lt: new Date(Date.now() - 120000) } },
          ],
        },
        data: { status: 'queued', workerId: null, attemptId: null, heartbeatAt: null, error: 'old heartbeat' },
      });
      expect(recovery.count).toBe(1);
    } finally {
      await cleanupTest(userId, projectId, aiJobId);
    }
  });

  // V14.1 §37: Old processingStartedAt + recent heartbeat → NOT recoverable
  test('old startedAt + recent heartbeat → NOT recovered', async () => {
    if (skipIfNoPg('old started recent heartbeat')) return;

    const { aiJobId, userId, projectId } = await createTestAIJob();
    try {
      await db.aIJob.updateMany({
        where: { id: aiJobId, status: 'queued' },
        data: {
          status: 'processing', workerId: `worker-${randomUUID()}`, attemptId: randomUUID(),
          attempt: { increment: 1 },
          heartbeatAt: new Date(), // RECENT heartbeat
          processingStartedAt: new Date(Date.now() - 999999), // OLD startedAt
        },
      });

      const recovery = await db.aIJob.updateMany({
        where: {
          id: aiJobId, status: 'processing',
          OR: [
            { heartbeatAt: { lt: new Date(Date.now() - 120000) } },
            { heartbeatAt: { equals: null }, processingStartedAt: { lt: new Date(Date.now() - 120000) } },
          ],
        },
        data: { status: 'queued', workerId: null, attemptId: null, heartbeatAt: null, error: 'should not happen' },
      });
      expect(recovery.count).toBe(0);

      const job = await db.aIJob.findUnique({ where: { id: aiJobId } });
      expect(job?.status).toBe('processing');
    } finally {
      await cleanupTest(userId, projectId, aiJobId);
    }
  });
});
