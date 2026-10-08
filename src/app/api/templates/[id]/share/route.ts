// /api/templates/[id]/share — POST (generate share URL + track share event)
//
// V19.1 §17: Real share API with persistence.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { ERROR_CODES } from '@/lib/errors/codes';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required.' } },
      { status: 401 },
    );
  }
  const { id: templateId } = await params;

  try {
    // V19.1 §17: Track share event (idempotent — repeated shares are OK, they
    // each create an analytics row because each share is a distinct action)
    await db.templateAnalytics.create({
      data: { templateId, event: 'share', userId: user.id },
    });
    await db.template.updateMany({
      where: { id: templateId },
      data: { shareCount: { increment: 1 } },
    });

    // V19.1 §17: Generate a shareable URL
    const shareUrl = `${process.env.PUBLIC_BASE_URL || 'https://vidiaforge.app'}/templates/${templateId}`;

    return NextResponse.json({ shareUrl, shared: true });
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'TEMPLATE_SHARE_FAILED', message: 'Failed to share template', details: String(err) } },
      { status: 500 },
    );
  }
}
