// /api/render/[id]/cancel — Mark job cancelled
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

export async function POST(_req: Request, { params }: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const job = await db.renderJob.findUnique({
    where: { id },
    include: { project: { select: { userId: true } } },
  });
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (job.project.userId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const updated = await db.renderJob.update({
    where: { id },
    data: {
      status: 'cancelled',
      completedAt: new Date(),
    },
  });

  return NextResponse.json({ job: jobDTO(updated) });
}
