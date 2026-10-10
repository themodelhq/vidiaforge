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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(
  message: string,
  status: number,
  extra: Record<string, unknown> = {},
  headers?: HeadersInit,
) {
  return NextResponse.json(
    {
      error: message,
      ...extra,
    },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        ...headers,
      },
    },
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export async function POST(req: Request) {
  // ---------------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------------

  const ip = getClientIP(req);
  const rl = checkAuthRate(ip);

  if (!rl.allowed) {
    return jsonError(
      'Too many login attempts. Please try again later.',
      429,
      {
        code: 'RATE_LIMITED',
      },
      rateLimitHeaders(rl),
    );
  }

  // ---------------------------------------------------------------------------
  // Parse request body
  // ---------------------------------------------------------------------------

  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON request body.', 400);
  }

  // ---------------------------------------------------------------------------
  // Validate request body
  // ---------------------------------------------------------------------------

  const payload =
    body && typeof body === 'object'
      ? (body as Record<string, unknown>)
      : {};

  const email =
    typeof payload.email === 'string'
      ? payload.email.trim().toLowerCase()
      : '';

  const password =
    typeof payload.password === 'string'
      ? payload.password
      : '';

  if (!email || !password) {
    return jsonError(
      'Email and password are required.',
      400,
    );
  }

  // ---------------------------------------------------------------------------
  // Find user
  // ---------------------------------------------------------------------------

  let user;

  try {
    user = await db.user.findUnique({
      where: {
        email,
      },
    });
  } catch (error) {
    console.error('[auth/login] database lookup failed:', {
      message: getErrorMessage(error),
    });

    return jsonError(
      'The authentication service is temporarily unavailable. Please try again shortly.',
      503,
      {
        code: 'AUTH_SERVICE_UNAVAILABLE',
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Verify credentials
  // ---------------------------------------------------------------------------

  let validPassword = false;

  try {
    validPassword =
      !!user?.passwordHash &&
      verifyPassword(password, user.passwordHash);
  } catch (error) {
    console.error('[auth/login] password verification failed:', {
      message: getErrorMessage(error),
    });

    validPassword = false;
  }

  if (!user || !validPassword) {
    return jsonError(
      'Invalid credentials.',
      401,
      {
        code: 'INVALID_CREDENTIALS',
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Create session
  // ---------------------------------------------------------------------------

  try {
    const token = await createSession(user.id);

    await setSessionCookie(token);
  } catch (error) {
    console.error('[auth/login] session creation failed:', {
      userId: user.id,
      message: getErrorMessage(error),
    });

    return jsonError(
      'Unable to sign you in right now. Please try again shortly.',
      503,
      {
        code: 'SESSION_CREATION_FAILED',
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Successful response
  // ---------------------------------------------------------------------------

  return NextResponse.json(
    {
      user: toUserDTO(user),
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        ...rateLimitHeaders(rl),
      },
    },
  );
}