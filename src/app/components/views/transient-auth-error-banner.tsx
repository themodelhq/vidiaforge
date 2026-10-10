'use client';

// VidiaForge V19.1 §6.2 — Transient auth-error banner
//
// Renders a small banner at the bottom of the viewport when the auth
// store has a `transientError` set (i.e. /api/auth/me failed with a
// network/5xx/timeout error and we deliberately did NOT clear the user's
// session). Provides a "Try again" button that calls `retry()` on the
// auth store.
//
// The banner is intentionally minimal — it does not block the editor or
// dashboard, it just informs the user that the connection to the backend
// is unstable and that their session has been preserved.

import { useAuthStore } from '@/stores/auth-store';
import { RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function TransientAuthErrorBanner() {
  const transientError = useAuthStore((s) => s.transientError);
  const retry = useAuthStore((s) => s.retry);
  const loading = useAuthStore((s) => s.loading);

  if (!transientError) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] max-w-md w-[calc(100%-2rem)] rounded-lg border border-amber-500/40 bg-amber-950/95 backdrop-blur px-3 py-2 shadow-2xl flex items-center gap-3"
    >
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-amber-100">
          Connection issue
        </p>
        <p className="text-[11px] text-amber-200/80 mt-0.5 truncate" title={transientError}>
          {transientError}
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={retry}
        disabled={loading}
        className="h-7 shrink-0 border-amber-500/40 bg-amber-900/40 text-amber-100 hover:bg-amber-900/60"
      >
        <RefreshCw className={`h-3 w-3 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
        Try again
      </Button>
      <button
        onClick={() => useAuthStore.setState({ transientError: null })}
        className="text-amber-200/60 hover:text-amber-100 shrink-0"
        aria-label="Dismiss connection issue banner"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
