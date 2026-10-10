// VidiaForge — Queue helper for API routes
// Creates BullMQ queues on-demand using REDIS_URL.
// If REDIS_URL is not set OR bullmq not installed, returns null and the caller
// must respond with 503 (no render/processing pipeline configured — be HONEST).

import type { QueueName } from './queue-names';

let ioredisMod: any = null;
let bullmqMod: any = null;
let redisClient: any = null;
const queueCache: Record<string, any> = {};

async function loadModules(): Promise<boolean> {
  if (ioredisMod && bullmqMod) return true;
  try {
    if (!bullmqMod) bullmqMod = await import('bullmq');
    if (!ioredisMod) ioredisMod = await import('ioredis');
    return !!bullmqMod?.Queue && !!ioredisMod?.default;
  } catch {
    return false;
  }
}

async function getRedis(): Promise<any | null> {
  if (redisClient) return redisClient;
  const ok = await loadModules();
  if (!ok) return null;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    redisClient = new ioredisMod.default(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
    redisClient.on('error', (err: unknown) => {
      console.error('[queue] Redis error:', err instanceof Error ? err.message : err);
    });
    return redisClient;
  } catch (err) {
    console.error('[queue] Failed to connect to Redis:', err instanceof Error ? err.message : err);
    return null;
  }
}

export interface EnqueueResult {
  ok: boolean;
  jobId?: string;
  error?: string;
}

/**
 * Enqueue a job to a named BullMQ queue.
 * Returns { ok: false, error } when Redis/BullMQ unavailable — caller should 503.
 */
export async function enqueue(queueName: QueueName, data: unknown): Promise<EnqueueResult> {
  const ok = await loadModules();
  if (!ok) {
    return {
      ok: false,
      error: 'BullMQ not installed. Install bullmq + ioredis or run the worker service.',
    };
  }
  const redis = await getRedis();
  if (!redis) {
    return {
      ok: false,
      error: 'REDIS_URL not configured. Render/media/processing pipelines require Redis.',
    };
  }
  try {
    let q = queueCache[queueName];
    if (!q) {
      q = new bullmqMod.Queue(queueName, { connection: redis });
      queueCache[queueName] = q;
    }
    const job = await q.add(queueName, data);
    return { ok: true, jobId: job.id ?? undefined };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to enqueue job: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Returns true if the queue system is available (Redis + BullMQ).
 * Used by /api/health for the redis status check.
 */
export async function isQueueAvailable(): Promise<boolean> {
  const ok = await loadModules();
  if (!ok) return false;
  const redis = await getRedis();
  if (!redis) return false;
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}
