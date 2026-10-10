'use client';

export function GlobalLoading() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-5">
        <div className="relative h-16 w-16">
          <div className="absolute inset-0 rounded-2xl bg-primary/15 blur-xl" />
          <svg viewBox="0 0 512 512" className="relative h-16 w-16 animate-pulse" aria-hidden>
            <defs>
              <linearGradient id="gl" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#f5a623" />
                <stop offset="100%" stopColor="#e07b1a" />
              </linearGradient>
            </defs>
            <circle cx="256" cy="256" r="140" fill="none" stroke="url(#gl)" strokeWidth="14" opacity="0.9" />
            <path d="M 204 178 L 348 256 L 204 334 Z" fill="url(#gl)" />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">VidiaForge</p>
          <p className="text-xs text-muted-foreground mt-1">Loading studio…</p>
        </div>
        <div className="h-1 w-32 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/2 animate-[loading_1.4s_ease-in-out_infinite] rounded-full bg-primary" style={{ animationName: 'loading' }} />
        </div>
      </div>
      <style>{`@keyframes loading { 0%{transform:translateX(-100%)} 100%{transform:translateX(200%)} }`}</style>
    </div>
  );
}
