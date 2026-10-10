'use client';

// VidiaForge — UI store: current view, panels, modals, toasts.
//
// V19.1 §7.D: The active view + pending project are persisted to
// localStorage so a full page refresh restores the user to the screen they
// were on (e.g. /editor with project X). This is the minimum viable fix
// for the "refresh signs the user out" bug — the auth store still gates
// rendering through its `initialized` flag, so protected views are not
// shown until the backend confirms a valid session. If the session has
// expired, the auth guard in page.tsx still redirects to /login.
//
// We deliberately do NOT persist transient modal open/close state, theme
// toggles, or sidebar collapse state — only the routing-relevant fields.

import { create } from 'zustand';
import type { ViewName } from '@/lib/types';

export interface CreateProjectDraft {
  name: string;
  canvasPreset: '16:9' | '9:16' | '1:1' | '4:5' | '4:3' | '21:9' | 'custom';
  resolution: '480p' | '720p' | '1080p' | '1440p' | '4K';
  fps: 24 | 25 | 30 | 50 | 60;
  customWidth?: number;
  customHeight?: number;
}

const PERSIST_KEY = 'vf:view-state:v1';

interface PersistedView {
  currentView: ViewName;
  pendingProjectId: string | null;
}

/**
 * Synchronously load the persisted view state from localStorage at module
 * load time. Returns null if storage is unavailable or there is no saved
 * state. Runs in `typeof window === 'undefined'` guard so SSR is safe.
 */
function loadPersistedView(): Partial<PersistedView> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const view = parsed.currentView;
    const pid = parsed.pendingProjectId;
    // Validate — only accept known view names + string|null project IDs.
    // `KNOWN_VIEWS.includes(view as ViewName)` would be unsafe if `view`
    // is an arbitrary string, so we type-narrow via a Set + runtime check.
    const KNOWN_VIEWS: ReadonlySet<ViewName> = new Set<ViewName>([
      'landing', 'login', 'register', 'dashboard', 'editor', 'settings',
    ]);
    const safeView: ViewName = typeof view === 'string' && KNOWN_VIEWS.has(view as ViewName)
      ? (view as ViewName)
      : 'landing';
    const safePid: string | null = typeof pid === 'string' ? pid : null;
    return { currentView: safeView, pendingProjectId: safePid };
  } catch {
    return null;
  }
}

/**
 * Save the persisted view state to localStorage. Best-effort — silently
 * ignore quota errors / unavailable storage.
 */
function savePersistedView(state: PersistedView): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PERSIST_KEY, JSON.stringify(state));
  } catch {
    // Ignore — best-effort persistence.
  }
}

/**
 * Clear the persisted view state. Called on logout so a stale "editor with
 * project X" entry doesn't bounce a freshly-signed-out user back into a
 * protected route.
 */
export function clearPersistedView(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PERSIST_KEY);
  } catch {
    // Ignore.
  }
}

const persisted = loadPersistedView();

interface UIState {
  // View routing
  currentView: ViewName;
  pendingProjectId: string | null;
  pendingAction: string | null;

  // Modals
  createProjectOpen: boolean;
  exportDialogOpen: boolean;
  shareDialogOpen: boolean;
  settingsDialogOpen: boolean;
  aiAssistantOpen: boolean;
  keyboardShortcutsOpen: boolean;

  // Editor sidebar
  activeSidebarTab: string;
  inspectorCollapsed: boolean;
  leftSidebarCollapsed: boolean;

  // Theme & preferences
  timecodeFormat: 'hhmmssff' | 'seconds';
  snap: boolean;
  magnetic: boolean;

  // Online/offline
  online: boolean;

  // Actions
  setView: (view: ViewName) => void;
  openProject: (projectId: string) => void;
  openDashboard: (action?: string) => void;
  setCreateProjectOpen: (open: boolean) => void;
  setExportDialogOpen: (open: boolean) => void;
  setShareDialogOpen: (open: boolean) => void;
  setSettingsDialogOpen: (open: boolean) => void;
  setAiAssistantOpen: (open: boolean) => void;
  setKeyboardShortcutsOpen: (open: boolean) => void;
  setActiveSidebarTab: (tab: string) => void;
  toggleInspector: () => void;
  toggleLeftSidebar: () => void;
  setOnline: (online: boolean) => void;
  setTimecodeFormat: (f: 'hhmmssff' | 'seconds') => void;
  toggleSnap: () => void;
  toggleMagnetic: () => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  // V19.1 §7.D: Restore from localStorage at store creation time. If no
  // persisted state exists, fall back to 'landing' (the public home page).
  currentView: persisted?.currentView ?? 'landing',
  pendingProjectId: persisted?.pendingProjectId ?? null,
  pendingAction: null,

  createProjectOpen: false,
  exportDialogOpen: false,
  shareDialogOpen: false,
  settingsDialogOpen: false,
  aiAssistantOpen: false,
  keyboardShortcutsOpen: false,

  activeSidebarTab: 'media',
  inspectorCollapsed: false,
  leftSidebarCollapsed: false,

  timecodeFormat: 'hhmmssff',
  snap: true,
  magnetic: true,
  online: true,

  setView: (view) => {
    set({ currentView: view });
    savePersistedView({
      currentView: view,
      pendingProjectId: get().pendingProjectId,
    });
  },
  openProject: (projectId) => {
    set({ currentView: 'editor', pendingProjectId: projectId, pendingAction: null });
    savePersistedView({ currentView: 'editor', pendingProjectId: projectId });
  },
  openDashboard: (action) => {
    set({ currentView: 'dashboard', pendingAction: action ?? null, pendingProjectId: null });
    savePersistedView({ currentView: 'dashboard', pendingProjectId: null });
  },
  setCreateProjectOpen: (open) => set({ createProjectOpen: open }),
  setExportDialogOpen: (open) => set({ exportDialogOpen: open }),
  setShareDialogOpen: (open) => set({ shareDialogOpen: open }),
  setSettingsDialogOpen: (open) => set({ settingsDialogOpen: open }),
  setAiAssistantOpen: (open) => set({ aiAssistantOpen: open }),
  setKeyboardShortcutsOpen: (open) => set({ keyboardShortcutsOpen: open }),
  setActiveSidebarTab: (tab) => set({ activeSidebarTab: tab }),
  toggleInspector: () => set((s) => ({ inspectorCollapsed: !s.inspectorCollapsed })),
  toggleLeftSidebar: () => set((s) => ({ leftSidebarCollapsed: !s.leftSidebarCollapsed })),
  setOnline: (online) => set({ online }),
  setTimecodeFormat: (f) => set({ timecodeFormat: f }),
  toggleSnap: () => set((s) => ({ snap: !s.snap })),
  toggleMagnetic: () => set((s) => ({ magnetic: !s.magnetic })),
}));
