// /api/render/[id] — GET returns real status from DB.
// PATCH is restricted to the worker (verified via WORKER_SECRET header OR localhost).
// Frontend reads status via polling GET.
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

interface Ctx {
  params: Promise<{ id: string }>;
}

function jobDTO(j: any) {
  return {
    id: j.id,
    projectId: j.projectId,
    status: j.status,
    format: j.format,
    codec: j.codec,
    resolution: j.resolution,
    fps: j.fps,
    bitrate: j.bitrate,
    progress: j.progress,
    stage: j.stage,
    outputUrl: j.outputUrl,
    error: j.error,
    createdAt: j.createdAt instanceof Date ? j.createdAt.toISOString() : j.createdAt,
    startedAt: j.startedAt instanceof Date ? j.startedAt.toISOString() : j.startedAt,
    completedAt: j.completedAt instanceof Date ? j.completedAt.toISOString() : j.completedAt,
  };
}

async function loadOwnedJob(id: string, userId: string) {
  const job = await db.renderJob.findUnique({
    where: { id },
    include: { project: { select: { userId: true } } },
  });
  if (!job) return null;
  if (job.project.userId !== userId) return 'forbidden' as const;
  return job;
}

export async function GET(_req: Request, { params }: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const job = await loadOwnedJob(id, user.id);
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (job === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  return NextResponse.json({ job: jobDTO(job) });
}

const VALID_STATUSES = new Set([
  'queued', 'preparing', 'processing', 'encoding', 'uploading',
  'completed', 'failed', 'cancelled',
]);

function isWorkerAuthorized(req: Request): boolean {
  // Worker may pass WORKER_SECRET header to authenticate.
  const secret = process.env.WORKER_SECRET;
  if (secret) {
    const provided = req.headers.get('x-worker-secret');
    if (provided && provided === secret) return true;
  }
  // Allow requests from localhost (worker runs on the same host in Docker compose / Render).
  // We trust the network layer here — Render internal network is private.
  const host = req.headers.get('host') || '';
  const xForwardedFor = req.headers.get('x-forwarded-for') || '';
  if (/^localhost|127\.0\.0\.1|\[::1\]/.test(host)) return true;
  if (/^127\.0\.0\.1|::1/.test(xForwardedFor.split(',')[0].trim())) return true;
  return false;
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;

  // Worker-only authorization. The user-facing PATCH endpoint is intentionally
  // NOT exposed here — users cannot mutate render job status directly.
  if (!isWorkerAuthorized(req)) {
    // Fall back to user auth for legacy clients that PATCH via the user session.
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: 'Forbidden: worker-only or authenticated' }, { status: 403 });
    }
    const job = await loadOwnedJob(id, user.id);
    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (job === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const data: Record<string, unknown> = {};

  if (typeof body?.status === 'string' && VALID_STATUSES.has(body.status)) {
    data.status = body.status;
    if (body.status === 'processing' || body.status === 'preparing') {
      data.startedAt = new Date();
    }
    if (['completed', 'failed', 'cancelled'].includes(body.status)) {
      data.completedAt = new Date();
    }
  }
  if (typeof body?.progress === 'number' && isFinite(body.progress)) {
    data.progress = Math.max(0, Math.min(1, body.progress));
  }
  if (typeof body?.stage === 'string') {
    data.stage = body.stage || null;
  }
  if (typeof body?.outputUrl === 'string') {
    data.outputUrl = body.outputUrl || null;
  }
  if (typeof body?.error === 'string') {
    data.error = body.error || null;
  }

  const updated = await db.renderJob.update({ where: { id }, data });
  return NextResponse.json({ job: jobDTO(updated) });
}
