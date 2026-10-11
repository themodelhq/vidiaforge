/**
 * VidiaForge combined free-tier runtime.
 * Runs the Next.js standalone API and BullMQ/FFmpeg worker in one Render
 * web-service container. The API is the public process; the worker's
 * health listener stays internal on WORKER_PORT (default 3001).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import process from 'node:process';

const root = '/app';
const workerDir = `${root}/mini-services/worker`;
const port = process.env.PORT || '3000';
const hostname = process.env.HOSTNAME || '0.0.0.0';

let apiChild: ChildProcess | null = null;
let workerChild: ChildProcess | null = null;
let workerRestartTimer: ReturnType<typeof setTimeout> | null = null;
let shuttingDown = false;
let workerRestartDelayMs = 2_000;
let shutdownTimer: ReturnType<typeof setTimeout> | null = null;

function configFingerprint(value: string | undefined): string {
  if (!value) return 'missing';
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function log(event: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    component: 'combined-runtime',
    event,
    time: new Date().toISOString(),
    ...extra,
  }));
}

function startApi() {
  log('api.starting', { port, hostname });
  apiChild = spawn('bun', ['--no-env-file', 'server.js'], {
    cwd: root,
    env: { ...process.env, PORT: port, HOSTNAME: hostname },
    stdio: 'inherit',
  });

  apiChild.on('error', (error) => {
    log('api.spawn_error', { message: error.message });
    void shutdown(1);
  });

  apiChild.on('exit', (code, signal) => {
    log('api.exited', { code, signal });
    if (!shuttingDown) void shutdown(typeof code === 'number' ? code || 1 : 1);
  });
}

function startWorker() {
  if (shuttingDown) return;
  log('worker.starting', { restartDelayMs: workerRestartDelayMs });

  const child = spawn('bun', ['--no-env-file', 'run', 'src/index.ts'], {
    cwd: workerDir,
    env: {
      ...process.env,
      WORKER_CONCURRENCY: process.env.WORKER_CONCURRENCY || '1',
      WORKER_PORT: process.env.WORKER_PORT || '3001',
      TEMP_DIR: process.env.TEMP_DIR || '/app/tmp',
      UPLOAD_DIR: process.env.UPLOAD_DIR || '/app/uploads',
    },
    stdio: 'inherit',
  });
  workerChild = child;

  child.on('error', (error) => {
    log('worker.spawn_error', { message: error.message });
  });

  child.on('exit', (code, signal) => {
    if (workerChild === child) workerChild = null;
    log('worker.exited', { code, signal, restarting: !shuttingDown });
    if (shuttingDown) return;

    const delay = workerRestartDelayMs;
    workerRestartDelayMs = Math.min(workerRestartDelayMs * 2, 30_000);
    log('worker.restart_scheduled', { delayMs: delay });
    workerRestartTimer = setTimeout(startWorker, delay);
  });
}

async function shutdown(exitCode: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('shutdown.started', { exitCode });

  if (workerRestartTimer) clearTimeout(workerRestartTimer);
  const children = [apiChild, workerChild].filter(Boolean) as ChildProcess[];
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch { /* already exited */ }
  }

  shutdownTimer = setTimeout(() => {
    for (const child of children) {
      try { child.kill('SIGKILL'); } catch { /* already exited */ }
    }
    process.exit(exitCode);
  }, 8_000);
  shutdownTimer.unref();

  // Exit promptly once all child processes have exited.
  const waitForExit = (child: ChildProcess) => new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', () => resolve());
  });
  await Promise.all(children.map(waitForExit));
  if (shutdownTimer) clearTimeout(shutdownTimer);
  process.exit(exitCode);
}

process.on('SIGTERM', () => void shutdown(0));
process.on('SIGINT', () => void shutdown(0));

log('runtime.starting', {
  nodeVersion: process.version,
  workerConcurrency: process.env.WORKER_CONCURRENCY || '1',
  databaseUrlFingerprint: configFingerprint(process.env.DATABASE_URL),
  redisUrlFingerprint: configFingerprint(process.env.REDIS_URL),
});
startApi();
startWorker();
