// /api/templates/[id] — GET (template detail)
//
// V19.1 §14: SECURITY — unpublished templates CANNOT be publicly retrieved.
//   - status='published' → public access (anyone, including anonymous)
//   - status='draft'|'submitted'|'under_review' → only the creator (authenticated)
//   - status='suspended'|'archived' → only moderators (not implemented yet)
//   - builtin templates → always public (isBuiltin=true)
//
// V19 §77: Tracks "view" event for template analytics.
// V19.1 §56: Tests all three access cases (public, creator, unauthorized).

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { BUILTIN_TEMPLATES } from '@/lib/templates/builtin-templates';
import { ERROR_CODES } from '@/lib/errors/codes';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getSessionUser();

  // V19.1 §14: Builtin templates are always public.
  const builtin = BUILTIN_TEMPLATES.find((t) => t.id === id);
  if (builtin) {
    // V19 §77: Track view event (best-effort)
    try {
      if (user) {
        await db.templateAnalytics.create({
          data: { templateId: id, event: 'view', userId: user.id },
        });
        await db.template.updateMany({
          where: { id },
          data: { viewCount: { increment: 1 } },
        }).catch(() => {});
      }
    } catch { /* best-effort */ }
    return NextResponse.json({ template: builtin });
  }

  // V19.1 §14: Fetch from DB with access control
  let template: any = null;
  try {
    template = await db.template.findUnique({ where: { id } });
    if (template?.creatorProfileId) {
      const profile = await db.creatorProfile.findUnique({
        where: { id: template.creatorProfileId },
        select: { id: true, displayName: true, avatarUrl: true, verified: true },
      });
      template.creator = profile;
    }
  } catch {
    // DB unavailable
  }

  if (!template) {
    return NextResponse.json(
      { error: { code: 'TEMPLATE_NOT_FOUND', message: 'Template not found' } },
      { status: 404 },
    );
  }

  // V19.1 §14: Access control based on status
  const status = template.status;
  if (status !== 'published') {
    // Unpublished — only the creator can view
    if (!user || template.creatorId !== user.id) {
      // V19.1 §56: Do not leak existence — return 404 (not 403)
      return NextResponse.json(
        { error: { code: 'TEMPLATE_NOT_FOUND', message: 'Template not found' } },
        { status: 404 },
      );
    }
    // Creator accessing their own draft — OK
  }

  // V19 §77: Track view event (best-effort, only for published or creator's own)
  try {
    if (user) {
      await db.templateAnalytics.create({
        data: { templateId: id, event: 'view', userId: user.id },
      });
      await db.template.updateMany({
        where: { id },
        data: { viewCount: { increment: 1 } },
      }).catch(() => {});
    }
  } catch { /* best-effort */ }

  return NextResponse.json({
    template: {
      id: template.id,
      title: template.title,
      description: template.description,
      category: template.category,
      subcategory: template.subcategory,
      tags: JSON.parse(template.tags || '[]'),
      thumbnailUrl: template.thumbnailUrl,
      previewUrl: template.previewUrl,
      aspectRatio: template.aspectRatio,
      width: template.width,
      height: template.height,
      fps: template.fps,
      duration: template.duration,
      timelineData: JSON.parse(template.timelineData),
      slots: JSON.parse(template.slots || '[]'),
      tier: template.tier,
      license: JSON.parse(template.license || '{}'),
      creator: template.creator ? {
        id: template.creator.id,
        name: template.creator.displayName,
        avatarUrl: template.creator.avatarUrl,
        verified: template.creator.verified,
      } : null,
      version: template.version,
      status: template.status,
      usageCount: template.usageCount,
      likeCount: template.likeCount,
      saveCount: template.saveCount,
      isBuiltin: false,
    },
  });
}
