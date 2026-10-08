'use client';

// VidiaForge — Auth store

import { create } from 'zustand';
import type { UserDTO } from '@/lib/types';

interface AuthState {
  user: UserDTO | null;
  loading: boolean;
  initialized: boolean;

  setUser: (user: UserDTO | null) => void;
  setLoading: (loading: boolean) => void;
  setInitialized: (initialized: boolean) => void;

  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

interface AuthMeResponse {
  user?: UserDTO | null;
  error?: string;
}

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

export const useAuthStore =
  create<AuthState>((set) => ({
    user: null,

    loading: false,

    initialized: false,

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

    refresh: async () => {
      set({
        loading: true,
      });

      try {
        const response =
          await fetch(
            '/api/auth/me',
            {
              method: 'GET',
              credentials: 'include',
              cache: 'no-store',
              headers: {
                Accept:
                  'application/json',
              },
            },
          );

        if (!response.ok) {
          set({
            user: null,
            initialized: true,
          });

          return;
        }

        const data =
          await readJsonSafely(
            response,
          );

        set({
          user:
            data?.user ??
            null,

          initialized: true,
        });
      } catch {
        set({
          user: null,
          initialized: true,
        });
      } finally {
        set({
          loading: false,
        });
      }
    },

    logout: async () => {
      try {
        await fetch(
          '/api/auth/logout',
          {
            method: 'POST',
            credentials: 'include',
            cache: 'no-store',
            headers: {
              Accept:
                'application/json',
            },
          },
        );
      } catch {
        // Logout remains best-effort.
      }

      set({
        user: null,
      });
    },
  }));