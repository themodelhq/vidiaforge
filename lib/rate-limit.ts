// VidiaForge — Simple in-memory rate limiter for auth endpoints.
// Production should use Redis-based rate limiting (e.g., bullmq + ioredis),
// but this provides a baseline protection against brute-force attacks.

interface RateBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateBucket>();
const WINDOW_MS = 60_000; // 1 minute
const AUTH_MAX = 10; // 10 auth attempts per minute per IP
const RENDER_MAX = 5; // 5 render requests per minute per user
const UPLOAD_MAX = 20; // 20 uploads per minute per user
const AI_MAX = 10; // 10 AI requests per minute per user

function getBucket(key: string, max: number): RateBucket {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, bucket);
  }
  return bucket;
}

function check(key: string, max: number): { allowed: boolean; remaining: number; resetAt: number } {
  const bucket = getBucket(key, max);
  if (bucket.count >= max) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }
  bucket.count++;
  return { allowed: true, remaining: max - bucket.count, resetAt: bucket.resetAt };
}

export function checkAuthRate(ip: string) {
  return check(`auth:${ip}`, AUTH_MAX);
}

export function checkRenderRate(userId: string) {
  return check(`render:${userId}`, RENDER_MAX);
}

export function checkUploadRate(userId: string) {
  return check(`upload:${userId}`, UPLOAD_MAX);
}

export function checkAiRate(userId: string) {
  return check(`ai:${userId}`, AI_MAX);
}

export function rateLimitHeaders(result: { remaining: number; resetAt: number }): Record<string, string> {
  return {
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
  };
}

// Periodic cleanup of expired buckets (every 5 minutes)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt < now) buckets.delete(key);
    }
  }, 5 * 60_000).unref?.();
}
