// /api/health/ready — Readiness check for the API container.
//
// Returns 200 if the API is ready to serve requests (DB + environment + storage
// all OK). Returns 503 if any required dependency is unavailable so the load
// balancer stops routing traffic to this instance.
//
// V5: Storage readiness now ACTUALLY TESTS storage connectivity (not just
// that the provider object can be constructed). For S3/R2, this does a
// HeadBucket-equivalent check. For local storage, it verifies the upload
// directory exists + is writable.
//
// The result distinguishes:
//   CONFIGURED — provider is configured with credentials
//   ACCESSIBLE — provider responded to a real authorization check
//   UNAVAILABLE — provider is not configured or the check failed
//
// FFmpeg is NOT checked here — it's a WORKER-ONLY dependency. The API container
// does not need FFmpeg. See /api/health/route.ts for the rationale.
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { validateEnv } from '@/lib/env-validation';
import { isQueueAvailable } from '@/lib/queue';
import { getStorage } from '@/lib/storage';

async function checkStorageReadiness(): Promise<{ status: 'ok' | 'error'; detail: string; accessible: boolean }> {
  try {
    const storage = getStorage();

    // V7 §33: Use the real checkHealth() method — performs an actual
    // authorized operation (HeadBucket for S3/R2, fs.access W_OK for local).
    // This is the REAL readiness check, not just "provider object constructed".
    const healthy = await storage.checkHealth();
    if (healthy) {
      return { status: 'ok', detail: `${storage.name} (accessible)`, accessible: true };
    } else {
      return { status: 'error', detail: `${storage.name} (configured but inaccessible)`, accessible: false };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'error', detail: `not configured: ${msg}`, accessible: false };
  }
}

export async function GET() {
  const checks: Record<string, { status: 'ok' | 'error' | 'degraded'; detail?: string; accessible?: boolean }> = {};

  // 1. Environment validation
  const envResult = validateEnv();
  checks.environment = {
    status: envResult.valid ? 'ok' : 'error',
    detail: envResult.valid ? `${envResult.env} mode` : envResult.errors.join('; '),
  };

  // 2. Database (required)
  try {
    await db.user.count();
    checks.database = { status: 'ok' };
  } catch (err) {
    checks.database = { status: 'error', detail: err instanceof Error ? err.message : String(err) };
  }

  // 3. Redis queue (recommended but NOT blocking for readiness — only for render)
  const queueOk = await isQueueAvailable();
  checks.queue = {
    status: queueOk ? 'ok' : 'degraded',
    detail: queueOk ? 'connected' : 'not configured (render/transcription unavailable, reads still serve)',
  };

  // 4. Storage (required) — V5: ACTUALLY test connectivity
  const storageResult = await checkStorageReadiness();
  checks.storage = {
    status: storageResult.status,
    detail: storageResult.detail,
    accessible: storageResult.accessible,
  };

  // Overall readiness: DB + environment + storage must pass. Queue is recommended
  // but not blocking for readiness (only for render/transcription functionality).
  const ready =
    checks.database.status === 'ok' &&
    checks.environment.status === 'ok' &&
    checks.storage.status === 'ok';

  const status = ready ? 'ready' : 'not_ready';
  return NextResponse.json(
    { status, checks, time: new Date().toISOString() },
    { status: ready ? 200 : 503 }
  );
}
