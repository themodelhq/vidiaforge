// /api/health/ready — Readiness check for the API container.
//
// Returns 200 when the database, environment, and required storage are ready.
// Returns 503 when a required dependency is unavailable. Queue availability is
// reported but remains non-blocking for API readiness.
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { validateEnv } from '@/lib/env-validation';
import { isQueueAvailable } from '@/lib/queue';
import { getStorage } from '@/lib/storage';

type StorageReadiness = {
  status: 'ok' | 'error';
  detail: string;
  accessible: boolean;
};

async function checkStorageReadiness(): Promise<StorageReadiness> {
  let providerName = 'unknown';

  try {
    const storage = getStorage();
    providerName = storage.name;

    const accessible = await storage.checkHealth();

    if (accessible) {
      return {
        status: 'ok',
        detail: `${providerName} (accessible)`,
        accessible: true,
      };
    }

    // The storage provider logs the sanitized failure classification.
    // Do not expose credentials or raw SDK exceptions in this response.
    return {
      status: 'error',
      detail: `${providerName} (configured but inaccessible; inspect server logs)`,
      accessible: false,
    };
  } catch (error: unknown) {
    const errorName =
      error instanceof Error ? error.name : 'UnknownError';

    console.error(
      JSON.stringify({
        event: 'storage.readiness_initialization_failed',
        provider: providerName,
        errorName,
      })
    );

    return {
      status: 'error',
      detail: `${providerName} (storage initialization failed; inspect server logs)`,
      accessible: false,
    };
  }
}

export async function GET() {
  const checks: Record<
    string,
    {
      status: 'ok' | 'error' | 'degraded';
      detail?: string;
      accessible?: boolean;
    }
  > = {};

  // 1. Environment validation
  const envResult = validateEnv();
  checks.environment = {
    status: envResult.valid ? 'ok' : 'error',
    detail: envResult.valid
      ? `${envResult.env} mode`
      : envResult.errors.join('; '),
  };

  // 2. Database
  try {
    await db.user.count();
    checks.database = { status: 'ok' };
  } catch {
    console.error(
      JSON.stringify({
        event: 'health.database_check_failed',
      })
    );

    checks.database = {
      status: 'error',
      detail: 'database unavailable; inspect server logs',
    };
  }

  // 3. Redis queue
  let queueOk = false;
  try {
    queueOk = await isQueueAvailable();
  } catch {
    queueOk = false;
  }

  checks.queue = {
    status: queueOk ? 'ok' : 'degraded',
    detail: queueOk ? 'connected' : 'not configured or unavailable',
  };

  // 4. Required storage dependency
  const storageResult = await checkStorageReadiness();
  checks.storage = {
    status: storageResult.status,
    detail: storageResult.detail,
    accessible: storageResult.accessible,
  };

  // Preserve the existing readiness policy: database, environment, and
  // storage must pass. Queue remains degraded rather than blocking readiness.
  const ready =
    checks.database.status === 'ok' &&
    checks.environment.status === 'ok' &&
    checks.storage.status === 'ok';

  return NextResponse.json(
    {
      status: ready ? 'ready' : 'not_ready',
      checks,
      time: new Date().toISOString(),
    },
    { status: ready ? 200 : 503 }
  );
}
