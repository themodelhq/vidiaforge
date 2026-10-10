'use client';

import { useEffect, useRef } from 'react';
import { useUIStore } from '@/stores/ui-store';
import { useEditorStore } from '@/stores/editor-store';
import { EditorTopBar } from '@/components/editor/editor-top-bar';
import { LeftSidebar } from '@/components/editor/left-sidebar';
import { CenterPreview } from '@/components/editor/center-preview';
import { RightInspector } from '@/components/editor/right-inspector';
import { BottomTimeline } from '@/components/editor/bottom-timeline';
import { EditorMobileView } from '@/components/editor/editor-mobile-view';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import { AlertCircle, Loader2, FolderOpen } from 'lucide-react';

export function EditorView() {
  const pendingProjectId = useUIStore((s) => s.pendingProjectId);
  const loadProject = useEditorStore((s) => s.loadProject);
  const projectId = useEditorStore((s) => s.projectId);
  const loading = useEditorStore((s) => s.loading);
  const loadError = useEditorStore((s) => s.loadError);
  const isMobile = useIsMobile();
  const lastLoadedRef = useRef<string | null>(null);

  // Load project when pendingProjectId changes
  useEffect(() => {
    if (pendingProjectId && pendingProjectId !== lastLoadedRef.current) {
      lastLoadedRef.current = pendingProjectId;
      loadProject(pendingProjectId);
    }
  }, [pendingProjectId, loadProject]);

  // Global keyboard shortcuts
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (isTyping) return;

      const s = useEditorStore.getState();
      const ui = useUIStore.getState();

      // Space = play/pause
      if (e.code === 'Space') {
        e.preventDefault();
        s.togglePlay();
        return;
      }
      // Cmd/Ctrl+Z = undo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        s.undo();
        return;
      }
      // Cmd/Ctrl+Shift+Z = redo
      if ((e.metaKey || e.ctrlKey) && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        s.redo();
        return;
      }
      // Cmd/Ctrl+Y = redo (alt)
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      // S = split
      if (e.key === 's' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        s.splitAtPlayhead();
        return;
      }
      // Delete/Backspace = delete selected
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        s.deleteSelected();
        return;
      }
      // D = duplicate
      if (e.key === 'd' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        s.duplicateSelected();
        return;
      }
      // I = mark in
      if (e.key === 'i' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        s.setInPoint(s.playhead);
        return;
      }
      // O = mark out
      if (e.key === 'o' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        s.setOutPoint(s.playhead);
        return;
      }
      // Arrow keys = frame nav
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        s.stepFrame(-1, s.project?.fps ?? 30);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        s.stepFrame(1, s.project?.fps ?? 30);
        return;
      }
      // Home = go to start
      if (e.key === 'Home') {
        e.preventDefault();
        s.seekTo(0);
        return;
      }
      // End = go to end
      if (e.key === 'End') {
        e.preventDefault();
        s.seekTo(s.duration);
        return;
      }
      // V = select tool
      if (e.key === 'v') { s.setTool('select'); return; }
      // B = blade
      if (e.key === 'b') { s.setTool('blade'); return; }
      // H = hand
      if (e.key === 'h') { s.setTool('hand'); return; }
      // Z = zoom tool (open zoom? for now just toggle)
      if (e.key === 'z' && !e.metaKey && !e.ctrlKey) {
        s.setZoom(s.zoom < 100 ? 160 : 80);
        return;
      }
      // Cmd/Ctrl+E = export
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault();
        ui.setExportDialogOpen(true);
        return;
      }
      // Cmd/Ctrl+S = save (force save now)
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        s.setSaveStatus('saving');
        // Force persist by scheduling immediately
        setTimeout(() => s.scheduleSave(), 0);
        return;
      }
      // ? = shortcuts
      if (e.key === '?') {
        e.preventDefault();
        ui.setKeyboardShortcutsOpen(true);
        return;
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Playback loop — advance playhead when playing
  useEffect(() => {
    if (!useEditorStore.getState().playing) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const s = useEditorStore.getState();
      if (!s.playing) return;
      const next = s.playhead + dt * s.playbackSpeed;
      if (next >= s.duration && s.duration > 0) {
        s.pause();
        s.seekTo(s.duration);
        return;
      }
      s.setPlayhead(next);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [useEditorStore((s) => s.playing)]);

  if (loading || (pendingProjectId && projectId !== pendingProjectId)) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground mt-3">Loading project…</p>
      </div>
    );
  }

  // V19.1 §8.C: Recovery state for failed project loads. Show the actual
  // error message + a clear path back to safety, instead of the previous
  // ambiguous "No project selected" screen which was the visible symptom
  // of the create-then-navigate-with-undefined-id bug.
  if (!projectId) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background px-6">
        <div className="max-w-md text-center">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-amber-500/15 flex items-center justify-center mb-4">
            <AlertCircle className="h-7 w-7 text-amber-500" />
          </div>
          <h2 className="text-lg font-semibold">
            {loadError ? 'Could not open project' : 'No project selected'}
          </h2>
          <p className="text-sm text-muted-foreground mt-2">
            {loadError ?? 'Open an existing project from your dashboard, or create a new one to start editing.'}
          </p>
          <div className="flex items-center justify-center gap-2 mt-5">
            <Button variant="outline" onClick={() => useUIStore.getState().openDashboard()}>
              <FolderOpen className="h-4 w-4 mr-2" /> Back to dashboard
            </Button>
            <Button onClick={() => useUIStore.getState().setCreateProjectOpen(true)}>
              Create project
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Mobile editor — dedicated experience
  if (isMobile) {
    return <EditorMobileView />;
  }

  return (
    <div className="flex h-screen flex-col bg-background overflow-hidden">
      <EditorTopBar />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <LeftSidebar />
        <div className="flex flex-1 min-w-0 flex-col">
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <CenterPreview />
            <RightInspector />
          </div>
          <BottomTimeline />
        </div>
      </div>
    </div>
  );
}
