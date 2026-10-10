'use client';

import { useEffect, useState, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { useUIStore } from '@/stores/ui-store';
import { LandingView } from '@/components/views/landing-view';
import { AuthView } from '@/components/views/auth-view';
import { DashboardView } from '@/components/views/dashboard-view';
import { EditorView } from '@/components/views/editor-view';
import { SettingsView } from '@/components/views/settings-view';
import { CreateProjectDialog } from '@/components/views/create-project-dialog';
import { ExportDialog } from '@/components/editor/export-dialog';
import { ShareDialog } from '@/components/editor/share-dialog';
import { SettingsDialog } from '@/components/editor/settings-dialog';
import { KeyboardShortcutsDialog } from '@/components/editor/keyboard-shortcuts-dialog';
import { GlobalLoading } from '@/components/views/global-loading';
import { TransientAuthErrorBanner } from '@/components/views/transient-auth-error-banner';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

function ViewRouter() {
  const currentView = useUIStore((s) => s.currentView);
  const user = useAuthStore((s) => s.user);
  const initialized = useAuthStore((s) => s.initialized);

  // Guard: dashboard / editor / settings require auth. Only enforce AFTER
  // the session has been restored from the backend — otherwise we'd bounce
  // a signed-in user to /login just because their session check hadn't
  // completed yet on first mount. (V19.1 §7.B step 6.)
  useEffect(() => {
    if (!initialized) return;
    if (!user && (currentView === 'dashboard' || currentView === 'editor' || currentView === 'settings')) {
      useUIStore.getState().setView('login');
    }
  }, [user, currentView, initialized]);

  // Parse initial URL query (?view=dashboard&action=new). Explicit query
  // params override the localStorage-persisted view — this preserves the
  // existing "click New Project from marketing email" flow.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view') as 'landing' | 'login' | 'register' | 'dashboard' | 'editor' | 'settings' | null;
    const action = params.get('action');
    if (view && ['dashboard', 'editor'].includes(view)) {
      // Will be guarded by auth effect above
      useUIStore.getState().openDashboard(action ?? undefined);
    }
  }, []);

  // While the session is being restored from the backend, show a clear
  // loading state instead of the destination view. This is the explicit
  // "authentication-loading state" required by V19.1 §7.B step 1.
  if (!initialized) return <GlobalLoading />;

  switch (currentView) {
    case 'landing':
      return <LandingView />;
    case 'login':
    case 'register':
      return <AuthView mode={currentView} />;
    case 'dashboard':
      return <DashboardView />;
    case 'editor':
      return <EditorView />;
    case 'settings':
      return <SettingsView />;
    default:
      return <LandingView />;
  }
}

function Modals() {
  return (
    <>
      <CreateProjectDialog />
      <ExportDialog />
      <ShareDialog />
      <SettingsDialog />
      <KeyboardShortcutsDialog />
    </>
  );
}

export default function Home() {
  const refresh = useAuthStore((s) => s.refresh);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Online/offline tracking
  useEffect(() => {
    const update = () => useUIStore.getState().setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<GlobalLoading />}>
        <ViewRouter />
        <Modals />
        {/*
          V19.1 §6.2: render the transient-error banner ABOVE the modals
          so a connection issue is visible regardless of which view the
          user is on. The banner only renders when `transientError` is set.
        */}
        <TransientAuthErrorBanner />
      </Suspense>
    </QueryClientProvider>
  );
}
