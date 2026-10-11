import { NextResponse } from 'next/server';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { getSessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { QUEUE_NAMES } from '@/lib/queue-names';
import { isDiagnosticsBearerAuthorized } from '@/lib/render/diagnostics-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Protected diagnostic endpoint for investigating render jobs stuck in queued.
 * Returns aggregate queue data only; never returns Redis URLs or credentials.
 */
export async function GET(req: Request) {
  // This endpoint supports both the existing signed-in session and a dedicated
  // operator token for Render-based diagnostics tools. The token is server-only.
  const tokenAuthorized = isDiagnosticsBearerAuthorized(
    req.headers.get('authorization'),
    process.env.RENDER_DIAGNOSTICS_TOKEN,
  );
  const user = tokenAuthorized ? null : await getSessionUser();
  if (!tokenAuthorized && !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return NextResponse.json(
      {
        status: 'error',
        code: 'REDIS_URL_MISSING',
        message: 'The API process does not have REDIS_URL configured.',
      },
      { status: 503 },
    );
  }

  let redis: IORedis | null = null;
  let queue: Queue | null = null;

  try {
    redis = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      connectTimeout: 5000,
    });

    await redis.ping();

    // Managed Redis providers may disable CONFIG GET. Treat that as
    // unsupported rather than failing otherwise-useful queue diagnostics.
    let redisEvictionPolicy: string | null = null;
    let redisEvictionPolicyCheck: 'ok' | 'warning' | 'unsupported' = 'unsupported';
    try {
      const configValues = await redis.config('GET', 'maxmemory-policy');
      if (Array.isArray(configValues)) {
        const policyIndex = configValues.findIndex((value: unknown) => value === 'maxmemory-policy');
        const policy = policyIndex >= 0 ? configValues[policyIndex + 1] : undefined;
        if (typeof policy === 'string') {
          redisEvictionPolicy = policy;
          redisEvictionPolicyCheck = policy === 'noeviction' ? 'ok' : 'warning';
        }
      }
    } catch {
      redisEvictionPolicyCheck = 'unsupported';
    }

    queue = new Queue(QUEUE_NAMES.RENDER, { connection: redis });

    const queueCounts = await queue.getJobCounts(
      'waiting',
      'active',
      'failed',
      'delayed',
      'completed',
      'paused',
    );

    // BullMQ exposes worker registrations for this queue. A count of zero
    // means the API cannot see a worker registered for the render queue.
    let workerCount: number | null = null;
    let workerRegistryCheck: 'ok' | 'unsupported' = 'ok';
    try {
      const workers = await (queue as any).getWorkers();
      workerCount = Array.isArray(workers) ? workers.length : null;
      if (!Array.isArray(workers)) workerRegistryCheck = 'unsupported';
    } catch {
      workerRegistryCheck = 'unsupported';
    }

    const databaseQueuedJobs = await db.renderJob.count({
      where: { status: 'queued' },
    });
    const oldestQueuedJob = await db.renderJob.findFirst({
      where: { status: 'queued' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });

    const oldestQueuedAgeSeconds = oldestQueuedJob
      ? Math.max(0, Math.floor((Date.now() - oldestQueuedJob.createdAt.getTime()) / 1000))
      : null;

    let diagnosis = 'Queue diagnostics collected.';
    if (redisEvictionPolicyCheck === 'warning') {
      diagnosis = `Redis maxmemory-policy is ${redisEvictionPolicy}; BullMQ recommends noeviction. Change this in the Redis provider settings.`;
    }
    if (workerCount === 0) {
      diagnosis = 'No workers are registered for the render queue. Check worker deployment/startup and confirm it uses the same Redis instance and queue name.';
    } else if ((queueCounts.waiting ?? 0) > 0 && (queueCounts.active ?? 0) === 0) {
      diagnosis = 'Jobs are waiting and none are active. Check whether the registered worker is consuming the render queue.';
    } else if ((queueCounts.active ?? 0) > 0) {
      diagnosis = 'At least one render queue job is active. Check job state and render processor progress next.';
    }

    return NextResponse.json({
      status: 'ok',
      queue: QUEUE_NAMES.RENDER,
      queueCounts,
      workerCount,
      workerRegistryCheck,
      redisEvictionPolicy,
      redisEvictionPolicyCheck,
      databaseQueuedJobs,
      oldestQueuedAgeSeconds,
      diagnosis,
      time: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error(JSON.stringify({
      event: 'render_queue_diagnostics_failed',
      errorName,
    }));
    return NextResponse.json(
      {
        status: 'error',
        code: 'RENDER_QUEUE_DIAGNOSTICS_FAILED',
        message: 'The API could not inspect the render queue. Check API Redis connectivity and BullMQ configuration.',
        errorName,
      },
      { status: 503 },
    );
  } finally {
    if (queue) await queue.close().catch(() => {});
    if (redis) await redis.quit().catch(() => {});
  }
}
