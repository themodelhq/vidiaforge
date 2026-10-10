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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function isPrismaUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as { code?: unknown };

  return candidate.code === 'P2002';
}

export async function POST(req: Request) {
  // ---------------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------------

  const ip = getClientIP(req);
  const rl = checkAuthRate(ip);

  if (!rl.allowed) {
    return jsonError(
      'Too many requests. Please try again later.',
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

  const name =
    typeof payload.name === 'string'
      ? payload.name.trim().slice(0, 100)
      : null;

  if (!EMAIL_RE.test(email)) {
    return jsonError('Invalid email address.', 400);
  }

  if (password.length < 8) {
    return jsonError(
      'Password must be at least 8 characters.',
      400,
    );
  }

  // ---------------------------------------------------------------------------
  // Create account
  // ---------------------------------------------------------------------------

  let user;

  try {
    const existing = await db.user.findUnique({
      where: {
        email,
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      return jsonError(
        'Email already registered.',
        409,
        {
          code: 'EMAIL_ALREADY_REGISTERED',
        },
      );
    }

    const passwordHash = hashPassword(password);

    user = await db.user.create({
      data: {
        email,
        name: name || null,
        passwordHash,
        preferences: {
          create: {},
        },
      },
    });
  } catch (error) {
    // A concurrent registration request can pass the findUnique() check
    // and still lose the unique-email race at INSERT time.
    if (isPrismaUniqueConstraintError(error)) {
      return jsonError(
        'Email already registered.',
        409,
        {
          code: 'EMAIL_ALREADY_REGISTERED',
        },
      );
    }

    
const diagnosticError =
  error && typeof error === 'object'
    ? (error as { name?: unknown; code?: unknown })
    : {};

console.error('[auth/register] account creation failed:', {
  name: diagnosticError.name,
  code: diagnosticError.code,
  message: getErrorMessage(error),
});

return jsonError(
  'Unable to create your account right now. Please try again shortly.',
  500,
  {
    code: 'REGISTRATION_FAILED',
    diagnostic: {
      errorType:
        typeof diagnosticError.name === 'string'
          ? diagnosticError.name
          : typeof error,
      databaseCode:
        typeof diagnosticError.code === 'string'
          ? diagnosticError.code
          : null,
      message: getErrorMessage(error)
  .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[DATABASE_URL_REDACTED]')
  .slice(0, 500),
    },
  },
);
  } // Closes catch (error)

  // ---------------------------------------------------------------------------
  // Create session
  // ---------------------------------------------------------------------------

  let token: string;

  try {
    token = await createSession(user.id);
    await setSessionCookie(token);
  } catch (error) {
    console.error('[auth/register] session creation failed:', {
      userId: user.id,
      message: getErrorMessage(error),
    });

    // Roll back the newly-created account if session creation failed.
    // UserPreferences is configured with onDelete: Cascade in Prisma.
    try {
      await db.user.delete({
        where: {
          id: user.id,
        },
      });
    } catch (cleanupError) {
      console.error(
        '[auth/register] failed to clean up partially-created account:',
        {
          userId: user.id,
          message: getErrorMessage(cleanupError),
        },
      );
    }

    return jsonError(
      'Your account could not be signed in automatically. Please try again.',
      500,
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
      status: 201,
      headers: {
        'Cache-Control': 'no-store',
        ...rateLimitHeaders(rl),
      },
    },
  );
}
