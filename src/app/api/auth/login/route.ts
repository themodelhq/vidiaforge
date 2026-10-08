// /api/auth/login — Verify password, create session
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  verifyPassword,
  createSession,
  setSessionCookie,
  toUserDTO,
} from '@/lib/auth';
import { checkAuthRate, rateLimitHeaders } from '@/lib/rate-limit';
import { getClientIP } from '@/lib/get-client-ip';

export async function POST(req: Request) {
  // Rate limit: 10 auth attempts per minute per IP
  const ip = getClientIP(req);
  const rl = checkAuthRate(ip);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many login attempts. Please try again later.', code: 'RATE_LIMITED' },
      { status: 429, headers: rateLimitHeaders(rl) }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
  }

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const token = await createSession(user.id);
  await setSessionCookie(token);

  return NextResponse.json({ user: toUserDTO(user) }, { headers: rateLimitHeaders(rl) });
}
