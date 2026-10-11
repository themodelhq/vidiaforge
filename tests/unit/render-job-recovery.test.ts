import { describe, expect, test } from 'bun:test';
import type { PrismaClient } from '@prisma/client';
import { recoverStaleRenderJobs } from '../../mini-services/worker/src/recovery';

function makeStaleRenderJob() {
  const old = new Date(Date.now() - 120_000);
  return {
    id: 'render-stale-test',
    status: 'processing',
    stage: 'encoding',
    progress: 0.1,
    workerId: 'dead-worker',
    attemptId: 'dead-attempt',
    heartbeatAt: old,
    startedAt: old,
    completedAt: null,
  };
}

describe('recoverStaleRenderJobs', () => {
  test('atomically resets a stale render lease and records it for requeue', async () => {
    const candidate = makeStaleRenderJob();
    let updateArgs: any = null;
    const db = {
      renderJob: {
        findMany: async () => [candidate],
        updateMany: async (args: any) => {
          updateArgs = args;
          return { count: 1 };
        },
      },
    } as unknown as PrismaClient;

    const stats = await recoverStaleRenderJobs(db, {
      leaseMs: 1_000,
      skipRequeue: true,
      log: () => {},
    });

    expect(stats.scanned).toBe(1);
    expect(stats.recovered).toBe(1);
    expect(stats.requeued).toBe(0);
    expect(stats.recoveredJobIds).toEqual([candidate.id]);
    expect(updateArgs.where.id).toBe(candidate.id);
    expect(updateArgs.where.attemptId).toBe(candidate.attemptId);
    expect(updateArgs.data).toMatchObject({
      status: 'queued',
      stage: 'queued',
      progress: 0,
      workerId: null,
      attemptId: null,
      heartbeatAt: null,
      startedAt: null,
      completedAt: null,
    });
  });

  test('does not reclaim a lease that changed after the stale scan', async () => {
    const candidate = makeStaleRenderJob();
    let updateCalls = 0;
    const db = {
      renderJob: {
        findMany: async () => [candidate],
        updateMany: async () => {
          updateCalls++;
          return { count: 0 };
        },
      },
    } as unknown as PrismaClient;

    const stats = await recoverStaleRenderJobs(db, {
      leaseMs: 1_000,
      skipRequeue: true,
      log: () => {},
    });

    expect(updateCalls).toBe(1);
    expect(stats.scanned).toBe(1);
    expect(stats.recovered).toBe(0);
    expect(stats.skipped).toBe(1);
    expect(stats.recoveredJobIds).toEqual([]);
  });

  test('does not attempt recovery when no stale render jobs exist', async () => {
    let updateCalls = 0;
    const db = {
      renderJob: {
        findMany: async () => [],
        updateMany: async () => {
          updateCalls++;
          return { count: 1 };
        },
      },
    } as unknown as PrismaClient;

    const stats = await recoverStaleRenderJobs(db, {
      leaseMs: 1_000,
      skipRequeue: true,
      log: () => {},
    });

    expect(stats.scanned).toBe(0);
    expect(stats.recovered).toBe(0);
    expect(updateCalls).toBe(0);
  });
});
