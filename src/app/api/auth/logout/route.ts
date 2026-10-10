// /api/auth/logout — Destroy session and clear cookie
import { NextResponse } from 'next/server';
import { destroySession, clearSessionCookie } from '@/lib/auth';

export async function POST() {
  await destroySession();
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
