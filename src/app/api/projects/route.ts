// /api/projects — List (GET) and create (POST) projects for current user
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import {
  CANVAS_DIMENSIONS,
  resolutionFor,
  emptyTimelineState,
} from '@/lib/timeline';
import type { CanvasPreset, ResolutionPreset, FpsPreset } from '@/lib/types';

const CANVAS_PRESETS: CanvasPreset[] = ['16:9', '9:16', '1:1', '4:5', '4:3', '21:9', 'custom'];
const RESOLUTIONS: ResolutionPreset[] = ['480p', '720p', '1080p', '1440p', '4K'];
const FPS_VALUES: FpsPreset[] = [24, 25, 30, 50, 60];

function isCanvasPreset(v: unknown): v is CanvasPreset {
  return typeof v === 'string' && (CANVAS_PRESETS as string[]).includes(v);
}
function isResolutionPreset(v: unknown): v is ResolutionPreset {
  return typeof v === 'string' && (RESOLUTIONS as string[]).includes(v);
}
function isFps(v: unknown): v is FpsPreset {
  return typeof v === 'number' && (FPS_VALUES as number[]).includes(v);
}

function projectToMeta(p: any) {
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
    createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
    updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt,
    lastOpenedAt: p.lastOpenedAt instanceof Date ? p.lastOpenedAt.toISOString() : p.lastOpenedAt,
  };
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const projects = await db.project.findMany({
    where: { userId: user.id },
    orderBy: { lastOpenedAt: 'desc' },
  });

  return NextResponse.json({ projects: projects.map(projectToMeta) });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = typeof body?.name === 'string' && body.name.trim()
    ? body.name.trim().slice(0, 120)
    : 'Untitled Project';

  const canvasPreset: CanvasPreset = isCanvasPreset(body?.canvasPreset) ? body.canvasPreset : '16:9';
  const resolution: ResolutionPreset = isResolutionPreset(body?.resolution) ? body.resolution : '1080p';
  const fps: FpsPreset = isFps(body?.fps) ? body.fps : 30;

  let width: number;
  let height: number;
  if (
    canvasPreset === 'custom' &&
    typeof body?.customWidth === 'number' &&
    typeof body?.customHeight === 'number' &&
    body.customWidth > 0 &&
    body.customHeight > 0
  ) {
    width = Math.round(body.customWidth / 2) * 2;
    height = Math.round(body.customHeight / 2) * 2;
  } else {
    const dims = resolutionFor(canvasPreset, resolution);
    width = dims.width;
    height = dims.height;
  }

  const timelineData = JSON.stringify(emptyTimelineState());
  // Touch CANVAS_DIMENSIONS so import is exercised (used internally by resolutionFor)
  void CANVAS_DIMENSIONS;

  const project = await db.project.create({
    data: {
      userId: user.id,
      name,
      width,
      height,
      fps,
      canvasPreset,
      resolution,
      timelineData,
      duration: 0,
      lastOpenedAt: new Date(),
    },
  });

  return NextResponse.json({ project: projectToMeta(project) }, { status: 201 });
}
