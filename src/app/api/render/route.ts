// /api/render — List render jobs for project (GET) and create new job (POST).
// POST enqueues a `render` BullMQ job if REDIS_URL is available.
// If REDIS_URL is not set, returns 503 with RENDER_QUEUE_NOT_CONFIGURED —
// be HONEST, never simulate progress.
//
// V6: Race-safe deduplication via renderIdentity (partial unique index).
// V6: Cached render validation via HeadObject before reuse.
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { enqueue } from '@/lib/queue';
import { QUEUE_NAMES } from '@/lib/queue-names';
import { ERROR_CODES } from '@/lib/errors/codes';
import { computeTimelineHash } from '@/lib/render/timeline-hash';
import { computeRenderIdentity } from '@/lib/render/render-identity';
import { getStorage } from '@/lib/storage';
import { checkRenderRate } from '@/lib/rate-limit';

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
    outputAssetId: j.outputAssetId,
    error: j.error,
    timelineHash: j.timelineHash,
    renderIdentity: j.renderIdentity,
    createdAt: j.createdAt instanceof Date ? j.createdAt.toISOString() : j.createdAt,
    startedAt: j.startedAt instanceof Date ? j.startedAt.toISOString() : j.startedAt,
    completedAt: j.completedAt instanceof Date ? j.completedAt.toISOString() : j.completedAt,
  };
}

async function getOwnedProject(id: string, userId: string) {
  const project = await db.project.findUnique({ where: { id } });
  if (!project) return null;
  if (project.userId !== userId) return 'forbidden' as const;
  return project;
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const projectId = url.searchParams.get('projectId');
  if (!projectId) {
    return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });
  }

  const project = await getOwnedProject(projectId, user.id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  if (project === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const jobs = await db.renderJob.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ jobs: jobs.map(jobDTO) });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Rate limit: 5 render requests per minute per user
  const rl = checkRenderRate(user.id);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many render requests. Please try again later.', code: 'RATE_LIMITED' },
      { status: 429 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const projectId = typeof body?.projectId === 'string' ? body.projectId : null;
  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  }

  const project = await getOwnedProject(projectId, user.id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  if (project === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const format = typeof body?.format === 'string' ? body.format : 'mp4';
  const codec = typeof body?.codec === 'string' ? body.codec : 'h264';
  const resolution = typeof body?.resolution === 'string' ? body.resolution : '1080p';
  const fps = typeof body?.fps === 'number' && body.fps > 0 ? body.fps : project.fps;
  const bitrate = typeof body?.bitrate === 'string' ? body.bitrate : 'medium';

  const timelineHash = computeTimelineHash(project.timelineData);
  const renderIdentity = computeRenderIdentity({
    projectId,
    timelineHash,
    format,
    resolution,
    fps,
    bitrate,
  });

  // V7 §9-13: Check for existing completed job + validate cached output.
  // CRITICAL FIX: If the cached output is invalid, we must ATOMICALLY INVALIDATE
  // the old completed job BEFORE creating a replacement. Without this, the old
  // completed job still owns the renderIdentity unique constraint, and the
  // replacement INSERT would fail with P2002 — rediscovering the same invalid
  // job in an infinite loop.
  const existingCompletedJob = await db.renderJob.findFirst({
    where: {
      renderIdentity,
      status: 'completed',
      outputAssetId: { not: null },
    },
    orderBy: { completedAt: 'desc' },
  });

  let cachedOutputAsset: { storagePath: string } | null = null;
  if (existingCompletedJob?.outputAssetId) {
    cachedOutputAsset = await db.mediaAsset.findUnique({
      where: { id: existingCompletedJob.outputAssetId },
      select: { storagePath: true },
    });
  }

  if (cachedOutputAsset) {
    // V7 §8/14: Validate the cached output via HeadObject before reuse.
    let cachedValid = false;
    let invalidReason = '';

    try {
      const storage = getStorage();
      const meta = await storage.headObject(cachedOutputAsset.storagePath);

      if (!meta) {
        invalidReason = 'STORAGE_OBJECT_MISSING';
      } else if (meta.size === 0) {
        invalidReason = 'ZERO_BYTE_OUTPUT';
      } else if (meta.contentType && !meta.contentType.startsWith('video/')) {
        invalidReason = `WRONG_CONTENT_TYPE:${meta.contentType}`;
      } else {
        // V7 §10: Efficient — HeadObject is sufficient for cache reuse.
        // Only run FFprobe if metadata is suspicious (size > 0 + video content-type).
        cachedValid = true;
      }
    } catch (err) {
      invalidReason = `HEAD_OBJECT_FAILED:${err instanceof Error ? err.message : String(err)}`;
    }

    if (cachedValid) {
      // V7 §13: VALID → return cached result
      return NextResponse.json({
        job: jobDTO(existingCompletedJob),
        cached: true,
        message: 'A render of this exact timeline + settings already exists — reusing it.',
      });
    }

    // V7 §9-12: INVALID → atomically invalidate the old completed job
    // so the renderIdentity unique constraint is released.
    // Use updateMany with conditional WHERE to prevent race:
    // only invalidate if the job is STILL completed (another request may
    // have already invalidated it).
    // V19: existingCompletedJob is non-null here because cachedOutputAsset was
    // derived from it. Add explicit non-null assertion for the type checker.
    const cachedJobId = existingCompletedJob!.id;
    console.warn(
      `[render] cached output for job ${cachedJobId} is INVALID (${invalidReason}) — invalidating + creating replacement`
    );

    await db.renderJob.updateMany({
      where: {
        id: cachedJobId,
        status: 'completed',
        renderIdentity,
      },
      data: {
        status: 'failed',
        error: JSON.stringify({ code: 'CACHED_OUTPUT_INVALID', reason: invalidReason }),
        stage: 'cache_invalidated',
        completedAt: new Date(),
      },
    });

    // The old completed job is now 'failed', releasing the renderIdentity
    // unique constraint (which only covers queued/processing/completed).
    // Fall through to create a new replacement render.
  }

  // V6 §11-14: Race-safe creation via renderIdentity + partial unique index.
  // The database enforces uniqueness: if two concurrent requests try to
  // INSERT the same renderIdentity with status='queued', the second one
  // fails with a unique constraint violation. We catch that and return
  // the existing job.
  try {
    const job = await db.renderJob.create({
      data: {
        projectId,
        status: 'queued',
        format,
        codec,
        resolution,
        fps,
        bitrate,
        timelineHash,
        renderIdentity,
        progress: 0,
      },
    });

    // Enqueue to render queue
    const enq = await enqueue(QUEUE_NAMES.RENDER, { jobId: job.id });
    if (!enq.ok) {
      await db.renderJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          stage: 'failed',
          error: `Render pipeline not configured: ${enq.error}`,
          completedAt: new Date(),
        },
      });
      return NextResponse.json(
        {
          error: 'Render queue not configured. Set REDIS_URL to enable rendering.',
          code: ERROR_CODES.RENDER_QUEUE_NOT_CONFIGURED,
          detail: enq.error,
        },
        { status: 503 }
      );
    }

    return NextResponse.json({ job: jobDTO(job), queued: true, queueJobId: enq.jobId }, { status: 201 });
  } catch (err: any) {
    // V6 §14: Check for unique constraint violation (P2002 in Prisma).
    // If another request created the same renderIdentity first, return that job.
    if (err?.code === 'P2002') {
      const existingJob = await db.renderJob.findFirst({
        where: {
          renderIdentity,
          status: { in: ['queued', 'processing', 'completed'] },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (existingJob) {
        return NextResponse.json({
          job: jobDTO(existingJob),
          deduplicated: true,
          message: 'An identical render job was just created — reusing it.',
        });
      }
    }
    throw err;
  }
}
