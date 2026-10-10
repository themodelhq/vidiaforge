// /api/projects/[id]/duplicate — Create a copy of the project
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
    createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
    updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt,
    lastOpenedAt: p.lastOpenedAt instanceof Date ? p.lastOpenedAt.toISOString() : p.lastOpenedAt,
  };
}

export async function POST(_req: Request, { params }: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const source = await db.project.findUnique({ where: { id } });
  if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (source.userId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const created = await db.project.create({
    data: {
      userId: user.id,
      name: `${source.name} (copy)`,
      description: source.description,
      width: source.width,
      height: source.height,
      fps: source.fps,
      canvasPreset: source.canvasPreset,
      resolution: source.resolution,
      schemaVersion: source.schemaVersion,
      timelineData: source.timelineData,
      duration: source.duration,
      thumbnailUrl: source.thumbnailUrl,
      favorite: false,
      lastOpenedAt: new Date(),
    },
  });

  return NextResponse.json({ project: projectFull(created) }, { status: 201 });
}
