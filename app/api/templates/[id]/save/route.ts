// /api/templates/[id]/save — POST (save) + DELETE (unsave)
//
// V19.1 §17: Real save/unsave APIs with persistence + uniqueness.

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
    const existing = await db.templateAnalytics.findFirst({
      where: { templateId, userId: user.id, event: 'save' },
    });
    if (existing) {
      return NextResponse.json({ saved: true });
    }
    await db.templateAnalytics.create({
      data: { templateId, event: 'save', userId: user.id },
    });
    await db.template.updateMany({
      where: { id: templateId },
      data: { saveCount: { increment: 1 } },
    });
    return NextResponse.json({ saved: true });
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'TEMPLATE_SAVE_FAILED', message: 'Failed to save template', details: String(err) } },
      { status: 500 },
    );
  }
}

export async function DELETE(
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
    const result = await db.templateAnalytics.deleteMany({
      where: { templateId, userId: user.id, event: 'save' },
    });
    if (result.count > 0) {
      await db.template.updateMany({
        where: { id: templateId },
        data: { saveCount: { decrement: 1 } },
      });
    }
    return NextResponse.json({ saved: false });
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'TEMPLATE_UNSAVE_FAILED', message: 'Failed to unsave template', details: String(err) } },
      { status: 500 },
    );
  }
}
