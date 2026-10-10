// /api/assets — List media assets for current user, optionally filtered by project
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

function assetDTO(a: any) {
  return {
    id: a.id,
    filename: a.filename,
    mimeType: a.mimeType,
    size: a.size,
    kind: a.kind,
    duration: a.duration,
    width: a.width,
    height: a.height,
    fps: a.fps,
    thumbnailUrl: a.thumbnailUrl,
    waveformUrl: a.waveformUrl,
    createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : a.createdAt,
    storagePath: a.storagePath,
    status: a.status || 'ready',
    errorMessage: a.errorMessage,
  };
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const projectId = url.searchParams.get('projectId') || undefined;

  const where: { userId: string; projectId?: string } = { userId: user.id };
  if (projectId) where.projectId = projectId;

  const assets = await db.mediaAsset.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ assets: assets.map(assetDTO) });
}
