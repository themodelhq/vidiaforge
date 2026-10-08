// /api/projects/[id] — GET (with lastOpenedAt bump), PATCH, DELETE
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

interface Ctx {
  params: Promise<{ id: string }>;
}

function projectFull(p: any) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    width: p.width,
    height: p.height,
    fps: p.fps,
    canvasPreset: p.canvasPreset,
    resolution: p.resolution,
    duration: p.duration,
    thumbnailUrl: p.thumbnailUrl,
    favorite: p.favorite,
    schemaVersion: p.schemaVersion,
    timelineData: p.timelineData,
    lastSnapshot: p.lastSnapshot,
    lastSavedAt: p.lastSavedAt instanceof Date ? p.lastSavedAt.toISOString() : p.lastSavedAt,
    createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
    updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt,
    lastOpenedAt: p.lastOpenedAt instanceof Date ? p.lastOpenedAt.toISOString() : p.lastOpenedAt,
  };
}

async function loadOwnedProject(id: string, userId: string) {
  const project = await db.project.findUnique({ where: { id } });
  if (!project) return null;
  if (project.userId !== userId) return 'forbidden' as const;
  return project;
}

export async function GET(_req: Request, { params }: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const project = await loadOwnedProject(id, user.id);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (project === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const updated = await db.project.update({
    where: { id },
    data: { lastOpenedAt: new Date() },
  });

  return NextResponse.json({ project: projectFull(updated) });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const project = await loadOwnedProject(id, user.id);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (project === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body?.name === 'string' && body.name.trim()) {
    data.name = body.name.trim().slice(0, 120);
  }
  if (typeof body?.description === 'string') {
    data.description = body.description.slice(0, 2000);
  }
  if (typeof body?.timelineData === 'string') {
    // Sanity check: must be JSON-parseable
    try {
      JSON.parse(body.timelineData);
      data.timelineData = body.timelineData;
    } catch {
      return NextResponse.json({ error: 'timelineData must be valid JSON' }, { status: 400 });
    }
  }
  if (typeof body?.duration === 'number' && isFinite(body.duration) && body.duration >= 0) {
    data.duration = body.duration;
  }
  if (typeof body?.favorite === 'boolean') {
    data.favorite = body.favorite;
  }
  if (typeof body?.thumbnailUrl === 'string') {
    data.thumbnailUrl = body.thumbnailUrl || null;
  }

  // updatedAt is managed by @updatedAt; explicitly touch to refresh
  data.updatedAt = new Date();

  const updated = await db.project.update({ where: { id }, data });
  return NextResponse.json({ project: projectFull(updated) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const project = await loadOwnedProject(id, user.id);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (project === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await db.project.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
