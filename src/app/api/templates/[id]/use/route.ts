// /api/templates/[id]/use — POST (create a new project from a template)
//
// V19 §5: Apply a template — create a new Project with the template's timelineData,
// apply slot assignments to the corresponding clips, and return the project.
//
// V19 §77: Tracks "use" event for template analytics.
// V19 §76: Templates never embed media files — only asset IDs / placeholder refs.
//
// Request body:
//   {
//     projectName?: string,  // defaults to template title
//     assignments?: SlotAssignment[],  // V19 §17: optional pre-fill
//   }
//
// Response:
//   {
//     project: { id, name, ... },
//     slots: TemplateSlot[],
//     slottedClipIds: string[]
//   }

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { BUILTIN_TEMPLATES } from '@/lib/templates/builtin-templates';
import { applySlotToClip, sanitizeTemplateData, type SlotAssignment, type TemplateDefinition } from '@/lib/templates';
import { ERROR_CODES } from '@/lib/errors/codes';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required.' } },
      { status: 401 }
    );
  }

  const { id: templateId } = await params;

  // Parse body (assignments are optional)
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }
  const projectName: string = typeof body.projectName === 'string' && body.projectName.trim()
    ? body.projectName.trim()
    : 'Untitled Project';
  const assignments: SlotAssignment[] = Array.isArray(body.assignments) ? body.assignments : [];

  // Load the template definition
  let template: TemplateDefinition | null = null;
  // Try DB first
  try {
    const dbTpl = await db.template.findUnique({
      where: { id: templateId, status: 'published' },
    });
    if (dbTpl) {
      template = {
        id: dbTpl.id,
        title: dbTpl.title,
        description: dbTpl.description || undefined,
        category: dbTpl.category,
        subcategory: dbTpl.subcategory || undefined,
        tags: JSON.parse(dbTpl.tags || '[]'),
        thumbnailUrl: dbTpl.thumbnailUrl || undefined,
        previewUrl: dbTpl.previewUrl || undefined,
        aspectRatio: dbTpl.canvasPreset as any,
        width: dbTpl.width,
        height: dbTpl.height,
        fps: dbTpl.fps,
        duration: dbTpl.duration,
        timelineData: JSON.parse(dbTpl.timelineData),
        slots: JSON.parse(dbTpl.slots || '[]'),
        tier: dbTpl.tier as any,
        license: JSON.parse(dbTpl.license || '{}'),
        version: dbTpl.version,
        isBuiltin: dbTpl.isBuiltin,
      };
    }
  } catch {
    // DB unavailable
  }

  // Fallback to builtin
  if (!template) {
    template = BUILTIN_TEMPLATES.find((t) => t.id === templateId) || null;
  }

  if (!template) {
    return NextResponse.json(
      { error: { code: 'TEMPLATE_NOT_FOUND', message: 'Template not found' } },
      { status: 404 }
    );
  }

  // V19 §75: Sanitize template data — prevent code injection / path traversal
  const sanitized = sanitizeTemplateData(template.timelineData);
  if (!sanitized) {
    return NextResponse.json(
      { error: { code: 'TEMPLATE_INVALID', message: 'Template timelineData failed sanitization' } },
      { status: 400 }
    );
  }

  // V19 §5: Apply slot assignments to clips
  const slotById = new Map(template.slots.map((s) => [s.id, s]));
  const clipsWithSlots = sanitized.timelineData.clips.map((clip: any) => {
    if (!clip.slotId) return clip;
    const slot = slotById.get(clip.slotId);
    if (!slot) return clip;
    const assignment = assignments.find((a) => a.slotId === slot.id);
    if (!assignment) return clip;
    return applySlotToClip(clip, slot, assignment);
  });

  // Create the new project with the template's timeline
  const newProject = await db.project.create({
    data: {
      userId: user.id,
      name: projectName,
      width: template.width,
      height: template.height,
      fps: template.fps,
      canvasPreset: template.aspectRatio,
      resolution: template.height >= 2160 ? '4K' : template.height >= 1440 ? '1440p' : '1080p',
      timelineData: JSON.stringify({
        schemaVersion: sanitized.timelineData.schemaVersion,
        tracks: sanitized.timelineData.tracks,
        clips: clipsWithSlots,
        markers: sanitized.timelineData.markers,
      }),
      duration: template.duration,
    },
  });

  // V19 §77: Track "use" event for template analytics (best-effort)
  try {
    await db.templateAnalytics.create({
      data: {
        templateId,
        event: 'use',
        userId: user.id,
        projectId: newProject.id,
        metadata: JSON.stringify({ slotCount: template.slots.length }),
      },
    });
    // Increment usageCount on the template (if it exists in DB)
    await db.template.updateMany({
      where: { id: templateId },
      data: { usageCount: { increment: 1 } },
    }).catch(() => {});
  } catch {
    // Analytics is best-effort
  }

  // V19 §5: Return the new project + slot info for the UI to show the slot panel
  return NextResponse.json({
    project: {
      id: newProject.id,
      name: newProject.name,
      width: newProject.width,
      height: newProject.height,
      fps: newProject.fps,
      canvasPreset: newProject.canvasPreset,
      resolution: newProject.resolution,
      duration: newProject.duration,
      timelineData: newProject.timelineData,
      createdAt: newProject.createdAt.toISOString(),
    },
    template: {
      id: template.id,
      title: template.title,
      slots: template.slots,
    },
    slottedClipIds: clipsWithSlots
      .filter((c: any) => c.slotId)
      .map((c: any) => c.id),
  }, { status: 201 });
}
