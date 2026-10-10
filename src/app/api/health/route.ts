// /api/health — Liveness probe for the API container.
//
// Returns 200 if the API process is alive + reachable + the DB is connected.
// Returns 500 if the DB is unreachable (the process is still alive but the
// request can't be served correctly — k8s/Render should NOT roll forward).
//
// V4-S2 (P1-32): REMOVED the FFmpeg check. FFmpeg is a WORKER-ONLY dependency
// — the API container never spawns FFmpeg. Checking it from the API meant the
// API was reported "degraded" in any deployment that splits API + worker into
// separate images (which is the recommended production topology — see
// worker.Dockerfile vs Dockerfile). The worker has its own /health endpoint
// (port 3001) + its own startup validation that DOES verify FFmpeg.
//
// FFmpeg availability for render jobs is surfaced via the worker's /health
// endpoint + the job's `error` field (if FFmpeg is missing, the render fails
// with a clear MediaProcessorUnavailableError — the user sees "ffmpeg not
// found" in the UI rather than the API silently reporting "degraded").
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getStorage } from '@/lib/storage';
import { isQueueAvailable } from '@/lib/queue';

export async function GET() {
  let dbStatus: 'connected' | 'error' = 'error';
  let dbError: string | undefined;
  try {
    await db.user.count();
    dbStatus = 'connected';
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  const redisStatus = (await isQueueAvailable()) ? 'connected' : 'not_configured';

  let storageProvider: 'local' | 's3' | 'r2' = 'local';
  try {
    const storage = getStorage();
    storageProvider = storage.name as 'local' | 's3' | 'r2';
  } catch {
    // getStorage() shouldn't throw, but if it does we still report local default
  }

  const ok = dbStatus === 'connected';
  return NextResponse.json(
    {
      status: ok ? 'ok' : 'degraded',
      time: new Date().toISOString(),
      db: dbStatus,
      dbError,
      redis: redisStatus,
      // FFmpeg is a worker-only dependency — the API container does not need it.
      // The worker's /health endpoint (port 3001) surfaces FFmpeg status.
      ffmpeg: 'not_checked',
      storage: storageProvider,
    },
    { status: ok ? 200 : 500 }
  );
}
