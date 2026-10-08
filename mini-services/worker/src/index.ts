// VidiaForge Worker Service — main entry
//
// BullMQ workers for: media-ingestion, render, ai, thumbnail, proxy, transcription.
//
// Tiny HTTP server on port 3001 with GET /health for liveness checks.
//
// S1: startup now performs PRE-FLIGHT VALIDATION before starting any BullMQ
// worker. If Redis / PostgreSQL / FFmpeg / FFprobe / storage config is missing
// or unreachable, the worker logs a structured JSON health report and exits
// with code 1 — never silently idle.
//
// Concurrency is controlled by the WORKER_CONCURRENCY env var (default 2).
//
// Graceful shutdown on SIGTERM / SIGINT closes workers + Redis + DB connections.

import { createServer } from 'http';
import { mkdir, access } from 'fs/promises';
import process from 'process';
import { PrismaClient } from '@prisma/client';

// Shared lib code lives at ../../../src/lib/ relative to this file
// (mini-services/worker/src/ → up 3 levels → repo root → src/lib).
const lib = '../../../src/lib';

// === Runtime singletons (set by startup validation) ============================

let Queue: any = null;
let Worker: any = null;
let redisConn: any = null;
let prismaClient: PrismaClient | null = null;
let recoverySchedulerHandle: { stop: () => void } | null = null;

const runningWorkers: any[] = [];
const runningWorkerNames: string[] = [];

// V17.1: Canonical recovery module — single source of truth.
// Imported here (production worker) AND by the integration test so the test
// invokes the SAME recoverStaleJobs() function.
import { recoverStaleJobs, startRecoveryScheduler } from './recovery';

// === Startup health report ======================================================

interface StartupHealth {
  redis: boolean;
  database: boolean;
  storage: boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
  ffmpegPath?: string;
  ffprobePath?: string;
  ffmpegVersion?: string;
  ffprobeVersion?: string;
  storageProvider?: string;
  errors: string[];
}

// === Redis connectivity =========================================================

async function checkRedis(): Promise<{ ok: boolean; error?: string }> {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    return {
      ok: false,
      error:
        'REDIS_URL env var is not set. BullMQ workers cannot run without Redis.',
    };
  }

  try {
    const ioredis: any = await import('ioredis');

    redisConn = new ioredis.default(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      connectTimeout: 5_000,
      retryStrategy: (times: number) => Math.min(times * 200, 2_000),
    });

    redisConn.on('error', (err: unknown) => {
      console.error(
        '[worker:redis] error:',
        err instanceof Error ? err.message : err,
      );
    });

    await redisConn.ping();

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    return {
      ok: false,
      error: `Failed to ping Redis at ${maskUrl(redisUrl)}: ${msg}`,
    };
  }
}

// === PostgreSQL connectivity ===================================================

async function checkDatabase(): Promise<{ ok: boolean; error?: string }> {
  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl) {
    return {
      ok: false,
      error:
        'DATABASE_URL env var is not set. Worker requires PostgreSQL access.',
    };
  }

  try {
    prismaClient = new PrismaClient({
      log:
        process.env.NODE_ENV === 'production'
          ? ['error']
          : ['error', 'warn'],
    });

    // Raw SELECT 1 — cheapest possible liveness check.
    await prismaClient.$queryRaw`SELECT 1`;

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    return {
      ok: false,
      error: `Failed to connect to PostgreSQL at ${maskUrl(dbUrl)}: ${msg}`,
    };
  }
}

// === Object storage configuration ==============================================

async function checkStorage(): Promise<{
  ok: boolean;
  error?: string;
  provider?: string;
}> {
  const provider = (process.env.STORAGE_PROVIDER || 'local').toLowerCase();

  // V9 §19: Use the REAL checkHealth() method — performs an actual authorized
  // operation (HeadBucket for S3/R2, fs.access W_OK for local). This verifies
  // credentials actually work, not just that env vars are set.

  try {
    const { getStorage } = await import(`${lib}/storage`);
    const storage = getStorage();

    const healthy = await storage.checkHealth();

    if (healthy) {
      return {
        ok: true,
        provider: storage.name,
      };
    } else {
      // checkHealth returned false — credentials/bucket may be wrong
      if (provider === 's3' || provider === 'r2') {
        const missing: string[] = [];

        if (!process.env.STORAGE_BUCKET) {
          missing.push('STORAGE_BUCKET');
        }

        if (!process.env.STORAGE_ACCESS_KEY) {
          missing.push('STORAGE_ACCESS_KEY');
        }

        if (!process.env.STORAGE_SECRET_KEY) {
          missing.push('STORAGE_SECRET_KEY');
        }

        if (missing.length > 0) {
          return {
            ok: false,
            provider,
            error: `S3/R2 missing env vars: ${missing.join(', ')}`,
          };
        }
      }

      return {
        ok: false,
        provider,
        error: `${storage.name} storage health check failed (credentials or bucket inaccessible)`,
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    return {
      ok: false,
      provider,
      error: `storage checkHealth error: ${msg}`,
    };
  }
}

// === FFmpeg / FFprobe resolution ==============================================

async function checkFfmpegBinaries(): Promise<{
  ffmpeg: {
    ok: boolean;
    path?: string;
    version?: string;
    error?: string;
  };
  ffprobe: {
    ok: boolean;
    path?: string;
    version?: string;
    error?: string;
  };
}> {
  // The MediaBinaryResolver lives in the shared src/lib/media/ tree so the
  // Next.js app can also use it. Lazy import keeps the worker decoupled from
  // the package layout at compile time.

  const ffmpegResult = {
    ok: false as boolean,
    path: undefined as string | undefined,
    version: undefined as string | undefined,
    error: undefined as string | undefined,
  };

  const ffprobeResult = {
    ok: false as boolean,
    path: undefined as string | undefined,
    version: undefined as string | undefined,
    error: undefined as string | undefined,
  };

  try {
    const { resolveFfmpeg } = await import(
      `${lib}/media/binary-resolver`
    );

    const resolved = await resolveFfmpeg();

    ffmpegResult.ok = true;
    ffmpegResult.path = resolved.path;
    ffmpegResult.version = resolved.version;
  } catch (err) {
    ffmpegResult.error =
      err instanceof Error ? err.message : String(err);
  }

  try {
    const { resolveFfprobe } = await import(
      `${lib}/media/binary-resolver`
    );

    const resolved = await resolveFfprobe();

    ffprobeResult.ok = true;
    ffprobeResult.path = resolved.path;
    ffprobeResult.version = resolved.version;
  } catch (err) {
    ffprobeResult.error =
      err instanceof Error ? err.message : String(err);
  }

  return {
    ffmpeg: ffmpegResult,
    ffprobe: ffprobeResult,
  };
}

// === BullMQ + Queue setup ======================================================

async function loadBullMQ(): Promise<boolean> {
  try {
    const mod: any = await import('bullmq');

    Queue = mod.Queue;
    Worker = mod.Worker;

    return true;
  } catch (err) {
    console.error(
      '[worker:bullmq] failed to import bullmq. ' +
        'Run `bun install` inside mini-services/worker. ' +
        `Underlying error: ${
          err instanceof Error ? err.message : String(err)
        }`,
    );

    return false;
  }
}

const QUEUE_NAMES = [
  'media-ingestion',
  'render',
  'ai',
  'thumbnail',
  'proxy',
  'transcription',
] as const;

async function setupWorkers(): Promise<void> {
  if (!redisConn || !Worker) return;

  const {
    processMediaIngestion,
    processThumbnailOnly,
    processProxyOnly,
  } = await import('./processors/media-ingestion');

  const { processRender } = await import('./processors/render');
  const { processTranscription } =
    await import('./processors/transcription');

  const processors: Record<
    string,
    (job: any) => Promise<void>
  > = {
    'media-ingestion': processMediaIngestion,
    render: processRender,
    transcription: processTranscription,
    thumbnail: processThumbnailOnly,
    proxy: processProxyOnly,

    // V9 §26: Generic AI jobs MUST NOT silently complete.
    // Returning normally would cause BullMQ to mark the job as "completed"
    // even though no work was done. Instead, THROW so the job is marked failed.
    ai: async (job: any) => {
      const jobKind = job?.data?.kind || job?.name || 'unknown';

      console.error(
        `[worker:ai] job ${job.id} rejected — unsupported AI kind: ${jobKind}`,
      );

      throw new Error(
        `AI_JOB_KIND_UNSUPPORTED: generic AI jobs are not implemented. Kind: ${jobKind}`,
      );
    },
  };

  const concurrency =
    parseInt(process.env.WORKER_CONCURRENCY || '2', 10) || 2;

  console.log(
    `[worker] concurrency=${concurrency} (from WORKER_CONCURRENCY)`,
  );

  for (const name of QUEUE_NAMES) {
    const handler = processors[name];

    if (!handler) continue;

    const w = new Worker(name, handler, {
      connection: redisConn,
      concurrency,
    });

    w.on('completed', (job: any) =>
      console.log(
        `[worker:${name}] job ${job.id} completed`,
      ),
    );

    w.on('failed', (job: any, err: unknown) =>
      console.error(
        `[worker:${name}] job ${job?.id} failed:`,
        err instanceof Error ? err.message : err,
      ),
    );

    w.on('error', (err: unknown) =>
      console.error(
        `[worker:${name}] error:`,
        err instanceof Error ? err.message : err,
      ),
    );

    runningWorkers.push(w);
    runningWorkerNames.push(name);
  }

  // V17.1 §8: Stale-job recovery — invokes the CANONICAL recoverStaleJobs()
  // from ./recovery.ts. This is the SAME function the integration test
  // calls — no duplicated SQL, no parallel recovery implementation.
  //
  // After the initial pass, startRecoveryScheduler() runs periodically
  // (default 60s) so jobs orphaned by a mid-flight crash are recovered even
  // if no worker restarts.

  await recoverStaleJobs(prismaClient, {
    log: (m) => console.log(m),
  });

  recoverySchedulerHandle =
    startRecoveryScheduler(prismaClient);

  console.log(
    '[worker] recovery scheduler started (interval from RECOVERY_INTERVAL_MS)',
  );
}

// === HTTP health server ========================================================

// V17.1 §46: Improved health endpoint — reports workerId, pid, and real
// status of postgres/redis/storage/ffmpeg/ffprobe/queue. Never fabricates.

function startHealthServer() {
  const PORT =
    parseInt(process.env.WORKER_PORT || '3001', 10);

  const server = createServer(async (req, res) => {
    if (req.url === '/health') {
      // V17.1: Re-check the critical dependencies on each /health request so
      // the report reflects real current state, not just startup-time state.
      // We don't re-check FFmpeg/FFprobe (slow exec) — those are stable
      // post-startup and were verified at boot.

      const pgOk = await safePgPing();
      const redisOk = await safeRedisPing();
      const storageOk = await safeStorageHealth();
      const queueOk = !!redisConn && redisOk;

      // All critical infra must be ok for status='ready'. If anything is
      // degraded, status='degraded' so callers (load balancers, k8s probes)
      // can route away. We never report 'ready' if anything is broken.

      const ready =
        pgOk &&
        redisOk &&
        storageOk &&
        queueOk;

      const body = {
        status: ready ? 'ready' : 'degraded',
        workerId:
          process.env.WORKER_ID ||
          `worker-${process.pid}`,
        pid: process.pid,
        postgres: pgOk ? 'ok' : 'fail',
        redis: redisOk ? 'ok' : 'fail',
        storage: storageOk ? 'ok' : 'fail',
        ffmpeg: 'ok', // verified at startup; not re-checked per request
        ffprobe: 'ok', // verified at startup
        queue: queueOk ? 'ready' : 'fail',
        queues: runningWorkerNames,
        time: new Date().toISOString(),
      };

      res.writeHead(
        ready ? 200 : 503,
        { 'Content-Type': 'application/json' },
      );

      res.end(JSON.stringify(body, null, 2));
      return;
    }

    if (req.url === '/health/live') {
      // Liveness — process is up. Always 200 if we got here.

      res.writeHead(
        200,
        { 'Content-Type': 'application/json' },
      );

      res.end(
        JSON.stringify({
          status: 'alive',
          pid: process.pid,
          time: new Date().toISOString(),
        }),
      );

      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(PORT, () => {
    console.log(
      `[worker] health server on http://localhost:${PORT}/health`,
    );
  });

  return server;
}

// Per-request infra pings (cheap; bounded by short timeouts).

async function safePgPing(): Promise<boolean> {
  if (!prismaClient) return false;

  try {
    await prismaClient.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function safeRedisPing(): Promise<boolean> {
  if (!redisConn) return false;

  try {
    const r = await Promise.race([
      redisConn.ping(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('timeout')),
          1_000,
        ),
      ),
    ]);

    return r === 'PONG';
  } catch {
    return false;
  }
}

async function safeStorageHealth(): Promise<boolean> {
  try {
    const { getStorage } =
      await import(`${lib}/storage`);

    return await getStorage().checkHealth();
  } catch {
    return false;
  }
}

// === Graceful shutdown =========================================================

function setupShutdown() {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;

    shuttingDown = true;

    console.log(
      `[worker] received ${signal}, shutting down...`,
    );

    // V17.1: Stop the recovery scheduler so we don't fire mid-shutdown.
    if (recoverySchedulerHandle) {
      recoverySchedulerHandle.stop();
      recoverySchedulerHandle = null;
    }

    await Promise.allSettled(
      runningWorkers.map((w) => w.close()),
    );

    if (redisConn) {
      await redisConn.quit().catch(() => {});
    }

    if (prismaClient) {
      await prismaClient
        .$disconnect()
        .catch(() => {});
    }

    process.exit(0);
  };

  process.on('SIGTERM', () =>
    void shutdown('SIGTERM'),
  );

  process.on('SIGINT', () =>
    void shutdown('SIGINT'),
  );
}

// === Helpers ===================================================================

function maskUrl(url: string): string {
  // Mask credentials in connection strings so logs don't leak passwords.

  try {
    return url.replace(
      /\/\/([^:]+):([^@]+)@/,
      '//$1:***@',
    );
  } catch {
    return '[unparseable url]';
  }
}

// === Main ======================================================================

async function main(): Promise<void> {
  console.log(
    '[worker] VidiaForge worker starting...',
  );

  console.log(
    `[worker] node=${process.version} platform=${process.platform} arch=${process.arch}`,
  );

  // Run pre-flight checks in parallel where independent.

  const [
    redisCheck,
    dbCheck,
    storageCheck,
    binaryCheck,
  ] = await Promise.all([
    checkRedis(),
    checkDatabase(),
    checkStorage(),
    checkFfmpegBinaries(),
  ]);

  // BullMQ module load (separate from Redis connectivity — the module itself
  // must be importable for setupWorkers() later).

  const bullmqLoaded = await loadBullMQ();

  const health: StartupHealth = {
    redis: redisCheck.ok,
    database: dbCheck.ok,
    storage: storageCheck.ok,
    ffmpeg: binaryCheck.ffmpeg.ok,
    ffprobe: binaryCheck.ffprobe.ok,
    ffmpegPath: binaryCheck.ffmpeg.path,
    ffprobePath: binaryCheck.ffprobe.path,
    ffmpegVersion: binaryCheck.ffmpeg.version,
    ffprobeVersion: binaryCheck.ffprobe.version,
    storageProvider: storageCheck.provider,
    errors: [],
  };

  if (!redisCheck.ok) {
    health.errors.push(
      `redis: ${redisCheck.error}`,
    );
  }

  if (!dbCheck.ok) {
    health.errors.push(
      `database: ${dbCheck.error}`,
    );
  }

  if (!storageCheck.ok) {
    health.errors.push(
      `storage: ${storageCheck.error}`,
    );
  }

  if (!binaryCheck.ffmpeg.ok) {
    health.errors.push(
      `ffmpeg: ${binaryCheck.ffmpeg.error}`,
    );
  }

  if (!binaryCheck.ffprobe.ok) {
    health.errors.push(
      `ffprobe: ${binaryCheck.ffprobe.error}`,
    );
  }

  if (!bullmqLoaded) {
    health.errors.push(
      'bullmq: module not installed (run `bun install` in mini-services/worker)',
    );
  }

  console.log(
    '[worker] startup health report:',
  );

  console.log(
    JSON.stringify(health, null, 2),
  );

  // Fail fast if any required dependency is missing.

  const allOk =
    health.redis &&
    health.database &&
    health.storage &&
    health.ffmpeg &&
    health.ffprobe &&
    bullmqLoaded;

  if (!allOk) {
    console.error(
      '[worker] STARTUP FAILED — missing required dependencies:',
    );

    for (const e of health.errors) {
      console.error(`  - ${e}`);
    }

    console.error(
      '[worker] refusing to start. Fix the above and redeploy.',
    );

    process.exit(1);
  }

  // All checks passed — start workers.

  await setupWorkers();

  console.log(
    `[worker] running queues: ${runningWorkerNames.join(', ')}`,
  );

  startHealthServer();
  setupShutdown();

  console.log(
    'VIDIAFORGE WORKER READY',
  );
}

main().catch((err) => {
  console.error(
    '[worker] fatal:',
    err,
  );

  process.exit(1);
});