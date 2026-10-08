'use client';

// VidiaForge — UI store: current view, panels, modals, toasts.
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

export const useUIStore = create<UIState>((set) => ({
  currentView: 'landing',
  pendingProjectId: null,
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

  setView: (view) => set({ currentView: view }),
  openProject: (projectId) =>
    set({ currentView: 'editor', pendingProjectId: projectId, pendingAction: null }),
  openDashboard: (action) =>
    set({ currentView: 'dashboard', pendingAction: action ?? null, pendingProjectId: null }),
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
