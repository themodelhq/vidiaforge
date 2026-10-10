// /api/projects/[id]/versions — List snapshots (GET) and create (POST)
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

interface Ctx {
  params: Promise<{ id: string }>;
}

function versionDTO(v: any) {
  return {
    id: v.id,
    projectId: v.projectId,
    label: v.label,
    snapshot: v.snapshot,
    createdAt: v.createdAt instanceof Date ? v.createdAt.toISOString() : v.createdAt,
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

  const versions = await db.projectVersion.findMany({
    where: { projectId: id },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ versions: versions.map(versionDTO) });
}

export async function POST(req: Request, { params }: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const project = await loadOwnedProject(id, user.id);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (project === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // allow empty body
  }
  const label = typeof body?.label === 'string' && body.label.trim()
    ? body.label.trim().slice(0, 120)
    : null;

  const version = await db.projectVersion.create({
    data: {
      projectId: id,
      label,
      snapshot: project.timelineData,
    },
  });

  return NextResponse.json({ version: versionDTO(version) }, { status: 201 });
}
