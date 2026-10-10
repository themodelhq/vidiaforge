// /api/templates/[id]/like — POST (like) + DELETE (unlike)
//
// V19.1 §17: Real like/unlike APIs with persistence + uniqueness.
// V19.1 §57: Idempotent — repeated likes don't create duplicates.

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
    // V19.1 §57: Idempotent — use upsert with composite unique (userId, templateId, event='like')
    // If already liked, the analytics row exists → don't increment likeCount.
    const existing = await db.templateAnalytics.findFirst({
      where: { templateId, userId: user.id, event: 'like' },
    });
    if (existing) {
      return NextResponse.json({ liked: true, likeCount: null });
    }
    await db.templateAnalytics.create({
      data: { templateId, event: 'like', userId: user.id },
    });
    await db.template.updateMany({
      where: { id: templateId },
      data: { likeCount: { increment: 1 } },
    });
    return NextResponse.json({ liked: true });
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'TEMPLATE_LIKE_FAILED', message: 'Failed to like template', details: String(err) } },
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
    // V19.1 §57: Idempotent — deleteMany is safe even if no rows match
    const result = await db.templateAnalytics.deleteMany({
      where: { templateId, userId: user.id, event: 'like' },
    });
    if (result.count > 0) {
      await db.template.updateMany({
        where: { id: templateId },
        data: { likeCount: { decrement: 1 } },
      });
    }
    return NextResponse.json({ liked: false });
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'TEMPLATE_UNLIKE_FAILED', message: 'Failed to unlike template', details: String(err) } },
      { status: 500 },
    );
  }
}
