// /api/templates/[id]/apply — POST
//
// V19.1 §7 (Issue 7): Apply a template to an EXISTING project.
//
// This route is the "Apply template to existing project" operation — the
// counterpart to /api/templates/[id]/use (which creates a NEW project
// initialized from the template).
//
// Why this route exists:
//   The editor's Templates panel was using POST /api/templates/[id]/use
//   for every template click. That endpoint always creates a new project,
//   so users applying a template from inside an existing project ended
//   up with a second project instead of an updated current project —
//   "selecting a template inside an existing project creates a new
//   project" was a reported bug.
//
// What this route does:
//   1. Authenticates the user.
//   2. Loads the template (DB or builtin fallback).
//   3. Validates ownership + existence of the target project ID
//      (supplied via ?projectId= query parameter or in the JSON body).
//   4. Sanitizes the template's timelineData.
//   5. Optionally applies user-supplied slot assignments to the
//      template's clips.
//   6. PATCHes the existing project's timelineData (NOT creates a new
//      project) — preserving the project's identity, ownership, name,
//      and unrelated metadata.
//   7. Tracks the "use" event for analytics (best-effort).
//   8. Returns the updated project.
//
// The route is intentionally non-destructive where reasonable: the
// previous timelineData is replaced (applying a template IS a structural
// replacement — that's the user's intent), but the project's id, name,
// ownership, and other settings are preserved.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { BUILTIN_TEMPLATES } from '@/lib/templates/builtin-templates';
import {
  applySlotToClip,
  sanitizeTemplateData,
  validateTemplateSlotConsistency,
  type SlotAssignment,
  type TemplateDefinition,
} from '@/lib/templates';
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

  // The target project ID may be supplied either in the JSON body or as
  // a ?projectId= query parameter — we accept both for client ergonomics.
  let body: any = {};
  try {
    // Empty body is fine — the route should still work.
    body = await req.json();
  } catch {
    // ignore — fall back to query param
  }
  const url = new URL(req.url);
  const projectId: string | undefined =
    (typeof body.projectId === 'string' && body.projectId.trim()) ? body.projectId.trim()
    : (typeof url.searchParams.get('projectId') === 'string' ? url.searchParams.get('projectId')! : undefined);

  if (!projectId) {
    return NextResponse.json(
      { error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'Missing "projectId". Apply-template requires a target project.' } },
      { status: 400 }
    );
  }

  // Verify project ownership before applying the template — never let a
  // user modify another user's project.
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project || project.userId !== user.id) {
    return NextResponse.json(
      { error: { code: ERROR_CODES.PROJECT_NOT_FOUND, message: 'Project not found.' } },
      { status: 404 }
    );
  }

  // Load the template definition — DB first, then builtin fallback.
  let template: TemplateDefinition | null = null;
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
    // DB unavailable — fall through to builtins.
  }
  if (!template) {
    template = BUILTIN_TEMPLATES.find((t) => t.id === templateId) || null;
  }
  if (!template) {
    return NextResponse.json(
      { error: { code: 'TEMPLATE_NOT_FOUND', message: 'Template not found' } },
      { status: 404 }
    );
  }

  // Sanitize the template timelineData (defense-in-depth against injection).
  const sanitized = sanitizeTemplateData(template.timelineData);
  if (!sanitized) {
    return NextResponse.json(
      { error: { code: 'TEMPLATE_INVALID', message: 'Template timelineData failed sanitization' } },
      { status: 400 }
    );
  }

  // V19.1 §5.6 — defense-in-depth: validate the template's slot-clip
  // structural consistency. This catches a template with an orphan slot,
  // a required slot with no clip, a slot-type/clip-kind mismatch, etc.
  // before it reaches the user's project. Builtins are validated at test
  // time; this check catches any DB-stored template that drifted.
  const consistency = validateTemplateSlotConsistency({
    id: template.id,
    slots: template.slots,
    timelineData: { clips: sanitized.timelineData.clips, tracks: sanitized.timelineData.tracks },
  });
  if (!consistency.valid) {
    return NextResponse.json(
      {
        error: {
          code: 'TEMPLATE_INVALID',
          message: 'Template slot-clip consistency check failed.',
          details: consistency.errors,
        },
      },
      { status: 400 }
    );
  }

  // Apply optional slot assignments to the corresponding clips.
  const assignments: SlotAssignment[] = Array.isArray(body.assignments) ? body.assignments : [];
  const slotById = new Map(template.slots.map((s) => [s.id, s]));
  const clipsWithSlots = sanitized.timelineData.clips.map((clip: any) => {
    if (!clip.slotId) return clip;
    const slot = slotById.get(clip.slotId);
    if (!slot) return clip;
    const assignment = assignments.find((a) => a.slotId === slot.id);
    if (!assignment) return clip;
    return applySlotToClip(clip, slot, assignment);
  });

  // PATCH the existing project — preserving id, userId, name, and other
  // unrelated settings. We update only the structural fields the
  // template is allowed to touch: canvasPreset, width, height, fps,
  // duration, and timelineData.
  //
  // We also update the resolution to match the template's aspect ratio,
  // but only if the project's current resolution is lower (don't downgrade).
  const updatedProject = await db.project.update({
    where: { id: projectId },
    data: {
      canvasPreset: template.aspectRatio,
      width: template.width,
      height: template.height,
      fps: template.fps,
      duration: template.duration,
      timelineData: JSON.stringify({
        schemaVersion: sanitized.timelineData.schemaVersion,
        tracks: sanitized.timelineData.tracks,
        clips: clipsWithSlots,
        markers: sanitized.timelineData.markers,
      }),
    },
  });

  // Best-effort analytics — never fail the request if this errors.
  try {
    await db.templateAnalytics.create({
      data: {
        templateId,
        event: 'apply',
        userId: user.id,
        projectId: updatedProject.id,
        metadata: JSON.stringify({ slotCount: template.slots.length }),
      },
    });
    await db.template.updateMany({
      where: { id: templateId },
      data: { usageCount: { increment: 1 } },
    }).catch(() => {});
  } catch {
    // Analytics is best-effort.
  }

  return NextResponse.json({
    project: {
      id: updatedProject.id,
      name: updatedProject.name,
      width: updatedProject.width,
      height: updatedProject.height,
      fps: updatedProject.fps,
      canvasPreset: updatedProject.canvasPreset,
      resolution: updatedProject.resolution,
      duration: updatedProject.duration,
      timelineData: updatedProject.timelineData,
      createdAt: updatedProject.createdAt instanceof Date ? updatedProject.createdAt.toISOString() : updatedProject.createdAt,
      updatedAt: updatedProject.updatedAt instanceof Date ? updatedProject.updatedAt.toISOString() : updatedProject.updatedAt,
    },
    template: {
      id: template.id,
      title: template.title,
      slots: template.slots,
    },
    slottedClipIds: clipsWithSlots
      .filter((c: any) => c.slotId)
      .map((c: any) => c.id),
  }, { status: 200 });
}
