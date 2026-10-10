// VidiaForge — Auth & session utilities
//
// Token-based sessions stored in PostgreSQL + httpOnly cookie.
// Password hashing uses Node's built-in crypto scrypt implementation.

import crypto from 'crypto';
import { cookies } from 'next/headers';
import { db } from './db';
import type { UserDTO } from './types';

export const SESSION_COOKIE = 'vf_session';

const SESSION_TTL_DAYS = 30;
const SESSION_TTL_SECONDS =
  SESSION_TTL_DAYS * 24 * 60 * 60;

const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_LENGTH = 64;
const SESSION_TOKEN_BYTES = 32;

/**
 * Hash a password using Node's built-in scrypt implementation.
 *
 * Stored format:
 *
 *   salt:hash
 */
export function hashPassword(password: string): string {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password must be a non-empty string.');
  }

  const salt = crypto
    .randomBytes(PASSWORD_SALT_BYTES)
    .toString('hex');

  const hash = crypto
    .scryptSync(
      password,
      salt,
      PASSWORD_KEY_LENGTH,
    )
    .toString('hex');

  return `${salt}:${hash}`;
}

/**
 * Verify a password against a stored scrypt hash.
 *
 * This function is deliberately fail-closed:
 * malformed stored hashes return false rather than throwing.
 */
export function verifyPassword(
  password: string,
  stored: string,
): boolean {
  try {
    if (
      typeof password !== 'string' ||
      typeof stored !== 'string'
    ) {
      return false;
    }

    const separatorIndex = stored.indexOf(':');

    if (separatorIndex <= 0) {
      return false;
    }

    const salt = stored.slice(0, separatorIndex);
    const storedHashHex = stored.slice(
      separatorIndex + 1,
    );

    if (!salt || !storedHashHex) {
      return false;
    }

    // scryptSync() above produces a 64-byte key = 128 hex chars.
    // Reject malformed values before Buffer conversion so
    // timingSafeEqual() can never receive differently-sized buffers.
    if (
      storedHashHex.length !==
      PASSWORD_KEY_LENGTH * 2
    ) {
      return false;
    }

    if (!/^[0-9a-f]+$/i.test(storedHashHex)) {
      return false;
    }

    const storedHash = Buffer.from(
      storedHashHex,
      'hex',
    );

    const computedHash = crypto.scryptSync(
      password,
      salt,
      PASSWORD_KEY_LENGTH,
    );

    if (
      storedHash.length !==
      computedHash.length
    ) {
      return false;
    }

    return crypto.timingSafeEqual(
      storedHash,
      computedHash,
    );
  } catch {
    return false;
  }
}

/**
 * Generate a cryptographically secure session token.
 */
export function generateToken(): string {
  return crypto
    .randomBytes(SESSION_TOKEN_BYTES)
    .toString('hex');
}

/**
 * Convert a Prisma User record into the public user DTO.
 *
 * Never expose passwordHash or other internal fields.
 */
export function toUserDTO(user: {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  plan: string;
  createdAt: Date;
}): UserDTO {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    plan: user.plan,
    createdAt: user.createdAt.toISOString(),
  };
}

/**
 * Create a persistent database-backed session.
 */
export async function createSession(
  userId: string,
): Promise<string> {
  if (!userId) {
    throw new Error(
      'Cannot create a session without a user ID.',
    );
  }

  const token = generateToken();

  const expiresAt = new Date(
    Date.now() +
      SESSION_TTL_DAYS *
        24 *
        60 *
        60 *
        1000,
  );

  await db.session.create({
    data: {
      userId,
      token,
      expiresAt,
    },
  });

  return token;
}

/**
 * Get the currently authenticated user.
 */
export async function getSessionUser(): Promise<UserDTO | null> {
  try {
    const cookieStore = await cookies();

    const token =
      cookieStore.get(SESSION_COOKIE)?.value;

    if (!token) {
      return null;
    }

    const session =
      await db.session.findUnique({
        where: {
          token,
        },
        include: {
          user: true,
        },
      });

    if (!session) {
      return null;
    }

    if (
      session.expiresAt.getTime() <=
      Date.now()
    ) {
      await db.session
        .delete({
          where: {
            id: session.id,
          },
        })
        .catch(() => {});

      return null;
    }

    return toUserDTO(session.user);
  } catch (error) {
    console.error(
      '[auth] failed to resolve session:',
      error instanceof Error
        ? error.message
        : String(error),
    );

    return null;
  }
}

/**
 * Destroy the current database-backed session.
 */
export async function destroySession(): Promise<void> {
  try {
    const cookieStore = await cookies();

    const token =
      cookieStore.get(SESSION_COOKIE)?.value;

    if (token) {
      await db.session
        .deleteMany({
          where: {
            token,
          },
        })
        .catch(() => {});
    }
  } catch {
    // Logout must remain best-effort.
  }
}

/**
 * Set the httpOnly session cookie.
 *
 * SameSite=Lax is correct when the browser accesses the
 * API through the Netlify same-origin /api proxy.
 *
 * If you intentionally bypass the Netlify proxy and call
 * the Render API directly from another site, change this
 * to SameSite=None and ensure CORS credentials are configured.
 */
export async function setSessionCookie(
  token: string,
): Promise<void> {
  if (!token) {
    throw new Error(
      'Cannot set an empty session cookie.',
    );
  }

  const cookieStore = await cookies();

  cookieStore.set(
    SESSION_COOKIE,
    token,
    {
      httpOnly: true,
      secure:
        process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    },
  );
}

/**
 * Clear the session cookie.
 */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(
    SESSION_COOKIE,
    '',
    {
      httpOnly: true,
      secure:
        process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: new Date(0),
      maxAge: 0,
    },
  );
}