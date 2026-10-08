// /api/auth/register — Create user + default preferences + session
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  hashPassword,
  createSession,
  setSessionCookie,
  toUserDTO,
} from '@/lib/auth';
import { checkAuthRate, rateLimitHeaders } from '@/lib/rate-limit';
import { getClientIP } from '@/lib/get-client-ip';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  // Rate limit: 10 auth attempts per minute per IP
  const ip = getClientIP(req);
  const rl = checkAuthRate(ip);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.', code: 'RATE_LIMITED' },
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
  const name = typeof body?.name === 'string' ? body.name.trim() : null;

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters' },
      { status: 400 }
    );
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
  }

  const passwordHash = hashPassword(password);
  const user = await db.user.create({
    data: {
      email,
      name,
      passwordHash,
      preferences: { create: {} },
    },
  });

  const token = await createSession(user.id);
  await setSessionCookie(token);

  return NextResponse.json({ user: toUserDTO(user) }, { status: 201 });
}
