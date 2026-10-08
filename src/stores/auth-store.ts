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

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: false,
  initialized: false,

  setUser: (user) => set({ user }),
  setLoading: (loading) => set({ loading }),
  setInitialized: (initialized) => set({ initialized }),

  refresh: async () => {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        set({ user: data.user ?? null, initialized: true });
      } else {
        set({ user: null, initialized: true });
      }
    } catch {
      set({ user: null, initialized: true });
    }
  },

  logout: async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    set({ user: null });
  },
}));
