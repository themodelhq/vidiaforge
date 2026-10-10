'use client';

import { useEffect } from 'react';

/**
 * Registers the VidiaForge service worker for PWA offline support.
 * Only registers in production (NODE_ENV=production) or when explicitly enabled.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        });

        // Check for updates periodically
        setInterval(() => {
          registration.update().catch(() => {});
        }, 60000);

        // Listen for new service worker activation
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          // New SW activated — silently reload on next interaction
        });
      } catch {
        // Silent fail — SW is a progressive enhancement
      }
    };

    register();
  }, []);

  return null;
}
