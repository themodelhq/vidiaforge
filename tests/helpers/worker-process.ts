// VidiaForge v17.1 — Worker Process Test Harness
//
// Launches/stops the ACTUAL worker process (mini-services/worker/src/index.ts)
// using child_process.spawn. This is NOT a mock — it runs the real worker
// entrypoint with real Prisma + Redis + BullMQ connections.
//
// V17.1 improvements:
//   - NODE_ENV=test is passed through by default so AIJOB_TEST_HOLD can activate
//     in the transcription processor (V17.1 §10 — fail-closed; only active when
//     NODE_ENV=test AND AIJOB_TEST_HOLD=true).
//   - Health endpoint expects status='ready' (V17.1 §46 worker health).
//   - Unique ports per worker (no hardcoded 3001)
//   - Real Redis PING validation (not just REDIS_URL exists)
//   - Real PostgreSQL SELECT 1 validation (not just DATABASE_URL exists)
//   - Process exit events (not just polling)
//   - workerId + PID in health response
//   - stdout/stderr capture for evidence

import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { createServer } from 'net';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export interface WorkerHandle {
  pid: number;
  workerId: string;
  port: number;
  process: ChildProcess;
  /** Path to the captured stdout log file (for evidence artifacts). */
  stdoutLogFile?: string;
  /** Path to the captured stderr log file (for evidence artifacts). */
  stderrLogFile?: string;
}

export interface InfraCheck {
  postgresql: boolean;
  redis: boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
  storage: boolean;
  error?: string;
}

/** Find a free TCP port for the worker health server */
async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        reject(new Error('Could not find free port'));
      }
    });
  });
}

/** Real Redis PING — not just checking REDIS_URL exists */
async function pingRedis(redisUrl: string): Promise<boolean> {
  try {
    const IORedis = (await import('ioredis')).default;
    const redis = new IORedis(redisUrl, { connectTimeout: 2000, maxRetriesPerRequest: 1 });
    const result = await redis.ping();
    redis.disconnect();
    return result === 'PONG';
  } catch {
    return false;
  }
}

/** Real PostgreSQL SELECT 1 — not just checking DATABASE_URL exists */
async function pingPostgres(databaseUrl: string): Promise<boolean> {
  try {
    const { PrismaClient } = await import('@prisma/client');
    const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
    await db.$queryRaw`SELECT 1`;
    await db.$disconnect();
    return true;
  } catch {
    return false;
  }
}

/** Check real infrastructure availability — V17.1: also checks FFmpeg/FFprobe/storage */
export async function checkInfrastructure(): Promise<InfraCheck> {
  const redisUrl = process.env.REDIS_URL || '';
  const databaseUrl = process.env.DATABASE_URL || '';

  const pgOk = databaseUrl ? await pingPostgres(databaseUrl) : false;
  const redisOk = redisUrl ? await pingRedis(redisUrl) : false;
  const ffmpegOk = await pingBinary('ffmpeg');
  const ffprobeOk = await pingBinary('ffprobe');
  const storageOk = await pingStorage();

  return {
    postgresql: pgOk,
    redis: redisOk,
    ffmpeg: ffmpegOk,
    ffprobe: ffprobeOk,
    storage: storageOk,
    error: !pgOk || !redisOk
      ? `PostgreSQL=${pgOk}, Redis=${redisOk}`
      : undefined,
  };
}

/** Check if a binary is on PATH by running it with -version */
async function pingBinary(name: string): Promise<boolean> {
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileP = promisify(execFile);
    await execFileP(name, ['-version'], { timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}

/** Check storage health via the real checkHealth() method */
async function pingStorage(): Promise<boolean> {
  try {
    const { getStorage } = await import('../../src/lib/storage');
    return await getStorage().checkHealth();
  } catch {
    return false;
  }
}

export class WorkerHarness {
  private proc: ChildProcess | null = null;
  private env: Record<string, string>;
  /** V17.1: Public so tests can log it / use it in evidence. */
  public port: number;
  public workerId: string;
  private exited: boolean = false;
  public stdoutBuffer: string[] = [];
  public stderrBuffer: string[] = [];

  constructor(opts?: { env?: Record<string, string>; workerId?: string }) {
    this.workerId = opts?.workerId || `test-worker-${randomUUID()}`;
    this.port = 0; // Will be assigned in start()
    // V17.1 §10: NODE_ENV=test by default so AIJOB_TEST_HOLD can activate.
    // This is REQUIRED for the test-hold barrier (it fails closed otherwise).
    // Tests that don't want the hold simply don't set AIJOB_TEST_HOLD=true.
    this.env = {
      ...process.env,
      // Force NODE_ENV=test unless the caller overrides it (production tests
      // would explicitly set NODE_ENV=production, which DISABLES the hold).
      NODE_ENV: process.env.NODE_ENV || 'test',
      ...(opts?.env || {}),
      WORKER_ID: this.workerId,
    };
  }

  /** Start the actual worker process on a unique port */
  async start(): Promise<WorkerHandle> {
    if (this.proc) throw new Error('Worker already started');

    this.port = await findFreePort();
    this.env.WORKER_PORT = String(this.port);

    const proc = spawn('bun', ['run', 'mini-services/worker/src/index.ts'], {
      env: this.env as NodeJS.ProcessEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
    });
    this.proc = proc;

    // V16.1: Use exit event instead of just polling
    proc.on('exit', (code, signal) => {
      this.exited = true;
      console.log(`[worker:${this.workerId}] exited code=${code} signal=${signal}`);
    });

    // Capture stdout/stderr for evidence
    proc.stdout?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line) {
        this.stdoutBuffer.push(line);
        console.log(`[worker:${this.workerId}] ${line}`);
      }
    });
    proc.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line) {
        this.stderrBuffer.push(line);
        console.error(`[worker:${this.workerId}:err] ${line}`);
      }
    });

    return {
      pid: proc.pid!,
      workerId: this.workerId,
      port: this.port,
      process: proc,
    };
  }

  /** Wait for the worker to report ready via health endpoint */
  async waitForReady(timeoutMs = 30_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (this.exited) return false;
      try {
        const res = await fetch(`http://localhost:${this.port}/health`);
        if (res.ok) {
          const data = await res.json();
          // V17.1 §46: worker reports status='ready' when all critical infra is ok.
          // We accept 'ready' (full) OR 'ok' (legacy) for backward compat.
          // We also accept 'degraded' for the case where storage is unavailable
          // in the test env but the worker is otherwise ready to process jobs.
          if (data.status === 'ready' || data.status === 'ok' || data.status === 'degraded') {
            // V17.1 §46: Verify this health response belongs to THIS worker.
            // The worker may report a different workerId if WORKER_ID wasn't
            // passed through — that's a bug we want to catch.
            if (data.workerId === this.workerId || !data.workerId) {
              return true;
            }
          }
        }
      } catch {
        // Not ready yet
      }
      await sleep(500);
    }
    return false;
  }

  /** Kill the worker process with SIGKILL (simulate crash) */
  kill(): void {
    if (this.proc && this.proc.pid) {
      try {
        process.kill(this.proc.pid, 'SIGKILL');
      } catch {
        // Already dead
      }
    }
  }

  /** Stop the worker gracefully with SIGTERM */
  async stopGracefully(timeoutMs = 10_000): Promise<void> {
    if (this.proc && this.proc.pid) {
      try {
        process.kill(this.proc.pid, 'SIGTERM');
      } catch { /* */ }
      await this.waitForExit(timeoutMs);
    }
  }

  /** Wait for the worker process to exit (uses exit event + polling fallback) */
  async waitForExit(timeoutMs = 10_000): Promise<boolean> {
    if (!this.proc || this.exited) return true;

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.exited) return true;
      // Polling fallback
      try {
        process.kill(this.proc.pid!, 0);
      } catch {
        this.exited = true;
        return true;
      }
      await sleep(200);
    }
    return false;
  }

  /** Check if the worker is still alive */
  isAlive(): boolean {
    if (this.exited) return false;
    if (!this.proc?.pid) return false;
    try {
      process.kill(this.proc.pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /** Get the health endpoint URL */
  get healthUrl(): string {
    return `http://localhost:${this.port}/health`;
  }

  /** V17.1 §56: Dump captured stdout/stderr to evidence files */
  dumpLogs(stdoutPath: string, stderrPath: string): void {
    try {
      mkdirSync(dirname(stdoutPath), { recursive: true });
      writeFileSync(stdoutPath, this.stdoutBuffer.join('\n') + '\n');
      writeFileSync(stderrPath, this.stderrBuffer.join('\n') + '\n');
    } catch (err) {
      console.warn(`[worker:${this.workerId}] failed to dump logs:`, err);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
