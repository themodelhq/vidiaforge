
/**
 * VidiaForge V8.7 — Authentication store regression tests
 *
 * File: tests/unit/auth-classification.test.ts
 *
 * These tests exercise the real useAuthStore.refresh() implementation.
 * They do not duplicate the private classifyResponse() helper.
 *
 * Covered behavior:
 * - 401 / 403: clear the invalid session.
 * - 5xx: preserve the existing user and expose a transient error.
 * - Network failure / timeout: preserve the existing user.
 * - Other 4xx: follow the store's existing invalid-session behavior.
 * - Valid 200 response: restore the returned user.
 * - 200 response without a user: clear the invalid session.
 *
 * No real backend or database is required.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import { useAuthStore } from '@/stores/auth-store';

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;

const existingUser = {
  id: 'test-user-001',
  email: 'test-user@example.com',
  name: 'VidiaForge Test User',
} as never;

const restoredUser = {
  id: 'restored-user-002',
  email: 'restored-user@example.com',
  name: 'Restored Test User',
} as never;

function setExistingSession(): void {
  useAuthStore.setState({
    user: existingUser,
    loading: false,
    initialized: false,
    transientError: null,

    // Exhaust the automatic retry budget so a transient test does not
    // schedule a real 1.5-second retry in the background.
    retryCount: 1,
  });
}

function setFetchResponse(response: Response): void {
  globalThis.fetch = (async () => response) as typeof fetch;
}

function setFetchFailure(error: unknown): void {
  globalThis.fetch = (async () => {
    throw error;
  }) as typeof fetch;
}

/**
 * The store starts a 10-second timeout for every refresh attempt.
 * When testing a rejected fetch, the current implementation does not clear
 * that timer in its catch branch. Disable real timers in these specific
 * tests so they do not leave a 10-second timer running.
 */
function disableRealTimeouts(): void {
  globalThis.setTimeout = (() =>
    0 as unknown as ReturnType<typeof setTimeout>
  ) as typeof setTimeout;
}

function responseWithStatus(
  status: number,
  body?: unknown,
): Response {
  const hasBody = body !== undefined;

  return new Response(
    hasBody ? JSON.stringify(body) : null,
    {
      status,
      headers: hasBody
        ? { 'Content-Type': 'application/json' }
        : undefined,
    },
  );
}

describe('VidiaForge auth store — session refresh', () => {
  beforeEach(() => {
    setExistingSession();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;

    useAuthStore.setState({
      user: null,
      loading: false,
      initialized: false,
      transientError: null,
      retryCount: 0,
    });
  });

  describe('explicitly invalid sessions', () => {
    test('401 clears the existing user', async () => {
      setFetchResponse(responseWithStatus(401));

      await useAuthStore.getState().refresh();

      const state = useAuthStore.getState();

      expect(state.user).toBeNull();
      expect(state.initialized).toBe(true);
      expect(state.loading).toBe(false);
      expect(state.transientError).toBeNull();
      expect(state.retryCount).toBe(0);
    });

    test('403 clears the existing user', async () => {
      setFetchResponse(responseWithStatus(403));

      await useAuthStore.getState().refresh();

      const state = useAuthStore.getState();

      expect(state.user).toBeNull();
      expect(state.initialized).toBe(true);
      expect(state.loading).toBe(false);
      expect(state.transientError).toBeNull();
    });

    test('404 clears the existing user under the current safe-default policy', async () => {
      setFetchResponse(responseWithStatus(404));

      await useAuthStore.getState().refresh();

      const state = useAuthStore.getState();

      expect(state.user).toBeNull();
      expect(state.initialized).toBe(true);
      expect(state.transientError).toBeNull();
    });

    test('410 clears the existing user under the current safe-default policy', async () => {
      setFetchResponse(responseWithStatus(410));

      await useAuthStore.getState().refresh();

      const state = useAuthStore.getState();

      expect(state.user).toBeNull();
      expect(state.initialized).toBe(true);
      expect(state.transientError).toBeNull();
    });

    test('429 follows the store current invalid-session policy', async () => {
      setFetchResponse(responseWithStatus(429));

      await useAuthStore.getState().refresh();

      const state = useAuthStore.getState();

      expect(state.user).toBeNull();
      expect(state.initialized).toBe(true);
      expect(state.transientError).toBeNull();
    });
  });

  describe('transient server failures', () => {
    test.each([500, 502, 503, 504])(
      '%i preserves the existing user',
      async (status) => {
        setFetchResponse(responseWithStatus(status));

        await useAuthStore.getState().refresh();

        const state = useAuthStore.getState();

        expect(state.user).toEqual(existingUser);
        expect(state.initialized).toBe(true);
        expect(state.loading).toBe(false);
        expect(state.transientError).not.toBeNull();
        expect(state.transientError).toContain(String(status));
        expect(state.retryCount).toBe(1);
      },
    );

    test('a network TypeError preserves the existing user', async () => {
      disableRealTimeouts();
      setFetchFailure(new TypeError('Failed to fetch'));

      await useAuthStore.getState().refresh();

      const state = useAuthStore.getState();

      expect(state.user).toEqual(existingUser);
      expect(state.initialized).toBe(true);
      expect(state.loading).toBe(false);
      expect(state.transientError).not.toBeNull();
      expect(state.transientError?.toLowerCase()).toContain('network');
      expect(state.retryCount).toBe(1);
    });

    test('an AbortError preserves the existing user', async () => {
      disableRealTimeouts();

      setFetchFailure(
        new DOMException(
          'The operation was aborted',
          'AbortError',
        ),
      );

      await useAuthStore.getState().refresh();

      const state = useAuthStore.getState();

      expect(state.user).toEqual(existingUser);
      expect(state.initialized).toBe(true);
      expect(state.loading).toBe(false);
      expect(state.transientError).not.toBeNull();
      expect(state.transientError?.toLowerCase()).toContain('timed out');
      expect(state.retryCount).toBe(1);
    });

    test('an unexpected fetch error preserves the existing user', async () => {
      disableRealTimeouts();
      setFetchFailure(new Error('Unexpected test failure'));

      await useAuthStore.getState().refresh();

      const state = useAuthStore.getState();

      expect(state.user).toEqual(existingUser);
      expect(state.initialized).toBe(true);
      expect(state.loading).toBe(false);
      expect(state.transientError).not.toBeNull();
      expect(state.retryCount).toBe(1);
    });
  });

  describe('successful session restoration', () => {
    test('200 with a user restores that user', async () => {
      setFetchResponse(
        responseWithStatus(200, {
          user: restoredUser,
        }),
      );

      await useAuthStore.getState().refresh();

      const state = useAuthStore.getState();

      expect(state.user).toEqual(restoredUser);
      expect(state.initialized).toBe(true);
      expect(state.loading).toBe(false);
      expect(state.transientError).toBeNull();
      expect(state.retryCount).toBe(0);
    });

    test('200 with no user clears the existing session', async () => {
      setFetchResponse(
        responseWithStatus(200, {}),
      );

      await useAuthStore.getState().refresh();

      const state = useAuthStore.getState();

      expect(state.user).toBeNull();
      expect(state.initialized).toBe(true);
      expect(state.loading).toBe(false);
      expect(state.transientError).toBeNull();
      expect(state.retryCount).toBe(0);
    });

    test('200 with malformed JSON clears the existing session', async () => {
      setFetchResponse(
        new Response('{invalid-json', {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      );

      await useAuthStore.getState().refresh();

      const state = useAuthStore.getState();

      expect(state.user).toBeNull();
      expect(state.initialized).toBe(true);
      expect(state.loading).toBe(false);
      expect(state.transientError).toBeNull();
    });
  });

  describe('regression guarantees', () => {
    test('a 500 response does not sign the user out', async () => {
      setFetchResponse(responseWithStatus(500));

      await useAuthStore.getState().refresh();

      expect(useAuthStore.getState().user).toEqual(existingUser);
    });

    test('a network failure does not sign the user out', async () => {
      disableRealTimeouts();
      setFetchFailure(new TypeError('Failed to fetch'));

      await useAuthStore.getState().refresh();

      expect(useAuthStore.getState().user).toEqual(existingUser);
    });

    test('a 401 response still signs the user out', async () => {
      setFetchResponse(responseWithStatus(401));

      await useAuthStore.getState().refresh();

      expect(useAuthStore.getState().user).toBeNull();
    });

    test('refresh sends a credentialed GET to the session endpoint', async () => {
      let capturedInput: RequestInfo | URL | undefined;
      let capturedInit: RequestInit | undefined;

      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        capturedInput = input;
        capturedInit = init;

        return responseWithStatus(200, {
          user: restoredUser,
        });
      }) as typeof fetch;

      await useAuthStore.getState().refresh();

      expect(capturedInput).toBe('/api/auth/me');
      expect(capturedInit?.method).toBe('GET');
      expect(capturedInit?.credentials).toBe('include');
      expect(capturedInit?.cache).toBe('no-store');
    });
  });
});
