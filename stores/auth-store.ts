'use client';

// VidiaForge — Auth store (V19.1 §6 — Phase Four)
//
// Session restoration semantics (V19.1 §6.2):
//
//   ┌──────────────────────────┬──────────────────────────────────────────┐
//   │ Response class           │ Action                                   │
//   ├──────────────────────────┼──────────────────────────────────────────┤
//   │ 200 OK + user             │ Restore user + view. Continue loading.   │
//   │ 401 / 403                 │ Backend explicitly says "no session".    │
//   │                           │ Clear user + persisted view. Show login. │
//   │ 5xx / timeout / network   │ Transient — do NOT clear user. Mark      │
//   │                           │ initialized=true so UI can render with    │
//   │                           │ the last known user (likely null on the  │
//   │                           │ very first load, or the previous user on │
//   │                           │ a refresh that hit a temporary outage).   │
//   │                           │ Retry once with a bounded backoff.        │
//   │ 200 OK but no user        │ Backend confirmed no session (cookie     │
//   │                           │ expired server-side). Clear + show login. │
//   └──────────────────────────┴──────────────────────────────────────────┘
//
// The previous implementation treated EVERY non-OK response as "invalid
// session" — including 500s and timeouts. That destroyed a valid local
// session during a transient API outage, surfacing as "user appears
// signed out after a server hiccup". This version distinguishes the two
// response classes and preserves recoverable client state.
//
// V19.1 §6.4 — security: never store passwords in browser storage, never
// expose session secrets to client bundles, preserve secure cookie
// attributes (httpOnly + Secure + SameSite=Lax) on the backend side. The
// client only ever reads the user DTO returned by /api/auth/me.

import { create } from 'zustand';
import type { UserDTO } from '@/lib/types';
import { clearPersistedView } from '@/stores/ui-store';

interface AuthState {
  user: UserDTO | null;
  loading: boolean;
  initialized: boolean;
  /** V19.1 §6.2: transientError is set when /api/auth/me fails with a
   * network/5xx/timeout. The UI can render a "connection issue" banner
   * and a Retry button. Cleared on next successful refresh. */
  transientError: string | null;
  /** V19.1 §6.2: retryCount tracks bounded retries for transient errors.
   * Resets to 0 on a successful refresh or an explicit invalid session. */
  retryCount: number;

  setUser: (user: UserDTO | null) => void;
  setLoading: (loading: boolean) => void;
  setInitialized: (initialized: boolean) => void;
  /** Manually trigger a retry after a transient error. Bounded by
   * MAX_RETRIES; once exceeded, the user can still click "Try again" in
   * the UI which calls refresh() directly. */
  retry: () => void;

  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

interface AuthMeResponse {
  user?: UserDTO | null;
  error?: string;
}

// V19.1 §6.2: Bounded retry — 1 retry with a 1.5s backoff. We do NOT
// infinite-loop on transient errors. The user can still manually retry
// via the UI button.
const MAX_RETRIES = 1;
const RETRY_BACKOFF_MS = 1500;

async function readJsonSafely(
  response: Response,
): Promise<AuthMeResponse | null> {
  const text = await response.text();

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(
      text,
    ) as AuthMeResponse;
  } catch {
    return null;
  }
}

/**
 * V19.1 §6.2: Classify a fetch failure into "explicit invalid session" vs
 * "transient infrastructure issue". Returns a human-readable reason for
 * transient failures (used in the UI banner).
 *
 * - 401, 403 → invalid session (returns null — caller clears user)
 * - 404, 405, 410 → treated as invalid (the endpoint disagrees with the
 *   client about the session shape; safest to clear)
 * - 5xx, 0 (network), timeout (AbortError) → transient (returns reason
 *   string; caller preserves user + schedules retry)
 * - other 4xx → ambiguous; treat as invalid to be safe
 */
function classifyResponse(response: Response | null, err: unknown): {
  invalidSession: boolean;
  transientReason: string | null;
} {
  // err non-null → network/timeout/abort
  if (err !== null && err !== undefined) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { invalidSession: false, transientReason: 'Session check timed out. The server may be slow or unreachable.' };
    }
    if (err instanceof TypeError) {
      // fetch() throws TypeError on network failure / DNS / CORS
      return { invalidSession: false, transientReason: 'Network error — could not reach the server. Check your connection.' };
    }
    return { invalidSession: false, transientReason: 'Could not verify your session. Please try again.' };
  }

  if (!response) {
    return { invalidSession: false, transientReason: 'No response from server.' };
  }

  // 401/403 → explicitly invalid session
  if (response.status === 401 || response.status === 403) {
    return { invalidSession: true, transientReason: null };
  }
  // 5xx → transient server error
  if (response.status >= 500 && response.status < 600) {
    return {
      invalidSession: false,
      transientReason: `The server returned an error (${response.status}). Your session is preserved — please retry.`,
    };
  }
  // Other 4xx → ambiguous; treat as invalid to be safe
  if (response.status >= 400) {
    return { invalidSession: true, transientReason: null };
  }
  // 2xx with no body / malformed body → treat as transient (backend may be
  // mid-restart; rare but recoverable)
  return {
    invalidSession: false,
    transientReason: 'Received an unexpected response from the server. Please retry.',
  };
}

export const useAuthStore =
  create<AuthState>((set, get) => ({
    user: null,

    loading: false,

    initialized: false,

    transientError: null,
    retryCount: 0,

    setUser: (user) =>
      set({
        user,
      }),

    setLoading: (loading) =>
      set({
        loading,
      }),

    setInitialized: (initialized) =>
      set({
        initialized,
      }),

    retry: () => {
      // Manual retry from the UI — reset the retry counter so a bounded
      // retry is available again, then call refresh().
      set({ retryCount: 0 });
      void get().refresh();
    },

    refresh: async () => {
      set({
        loading: true,
        // Clear any prior transient error at the start of a new attempt.
        transientError: null,
      });

      const attemptOnce = async (): Promise<{
        ok: boolean;
        invalidSession: boolean;
        transientReason: string | null;
      }> => {
        try {
          // V19.1 §6.4: bounded timeout via AbortController. 10s is
          // generous enough for slow cold-starts on Render's free tier
          // but short enough to surface "server slow" as a transient
          // error rather than hanging forever.
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10_000);
          const response = await fetch('/api/auth/me', {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (!response.ok) {
            const cls = classifyResponse(response, null);
            if (cls.invalidSession) {
              return { ok: false, invalidSession: true, transientReason: null };
            }
            return { ok: false, invalidSession: false, transientReason: cls.transientReason };
          }

          const data = await readJsonSafely(response);
          if (!data?.user) {
            // 200 OK but no user — backend confirmed no session.
            return { ok: false, invalidSession: true, transientReason: null };
          }
          // Success — restore user.
          set({
            user: data.user,
            initialized: true,
            transientError: null,
            retryCount: 0,
          });
          return { ok: true, invalidSession: false, transientReason: null };
        } catch (err) {
          const cls = classifyResponse(null, err);
          return {
            ok: false,
            invalidSession: cls.invalidSession,
            transientReason: cls.transientReason,
          };
        }
      };

      const result = await attemptOnce();

      if (result.ok) {
        set({ loading: false });
        return;
      }

      if (result.invalidSession) {
        // V19.1 §6.2: backend explicitly confirmed no session — clear user
        // + persisted view, mark initialized so the auth guard redirects
        // to /login.
        clearPersistedView();
        set({
          user: null,
          initialized: true,
          loading: false,
          transientError: null,
          retryCount: 0,
        });
        return;
      }

      // Transient failure — preserve user state (do NOT clear), schedule
      // a single bounded retry.
      const currentRetry = get().retryCount;
      if (currentRetry < MAX_RETRIES) {
        set({
          initialized: true, // let UI render with last-known user
          loading: false,
          transientError: result.transientReason,
          retryCount: currentRetry + 1,
        });
        // Bounded retry — fires once after backoff.
        setTimeout(() => {
          // Only retry if we're still in the transient state (the user
          // may have manually logged out / navigated in the meantime).
          if (get().transientError && get().retryCount <= MAX_RETRIES) {
            void get().refresh();
          }
        }, RETRY_BACKOFF_MS);
        return;
      }

      // Retry budget exhausted — surface the transient error to the UI;
      // the user can manually click "Try again" which calls retry().
      set({
        initialized: true,
        loading: false,
        transientError: result.transientReason ??
          'Could not verify your session. Please try again.',
      });
    },

    logout: async () => {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
      } catch {
        // Logout remains best-effort.
      }

      // V19.1 §6.2: Clear persisted view + local user atomically so a
      // signed-out user doesn't bounce back into a protected route.
      clearPersistedView();
      set({
        user: null,
        initialized: true,
        loading: false,
        transientError: null,
        retryCount: 0,
      });
    },
  }));
