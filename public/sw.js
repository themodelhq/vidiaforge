// VidiaForge Service Worker — app shell caching + offline fallback.
// Versioned cache strategy: cache-first for app shell, network-first for API.

const CACHE_VERSION = 'vidiaforge-v1';
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const APP_SHELL_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
  '/icons/favicon-16.png',
];

// Install: pre-cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => {
      return cache.addAll(APP_SHELL_ASSETS).catch((err) => {
        // Don't fail installation if some assets are missing
        console.warn('[SW] Some app shell assets failed to cache:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key.startsWith('vidiaforge-') && key !== APP_SHELL_CACHE)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch strategy
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip cross-origin requests (API calls to different domains)
  if (url.origin !== self.location.origin) return;

  // Skip API routes — always network (don't cache dynamic data)
  if (url.pathname.startsWith('/api/')) return;

  // Skip Next.js HMR + dev assets in development
  if (url.pathname.startsWith('/_next/webpack-hmr')) return;

  // App shell: cache-first
  if (APP_SHELL_ASSETS.includes(url.pathname) || url.pathname === '/') {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          // Cache a copy
          if (response.ok && response.type === 'basic') {
            const clone = response.clone();
            caches.open(APP_SHELL_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        }).catch(() => {
          // Offline fallback
          if (request.destination === 'document') {
            return caches.match('/');
          }
        });
      })
    );
    return;
  }

  // Static assets (_next/static/*): cache-first with network fallback
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const clone = response.clone();
            caches.open(APP_SHELL_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Everything else: network-first, fall back to cache
  event.respondWith(
    fetch(request).then((response) => {
      if (response.ok && response.type === 'basic') {
        const clone = response.clone();
        caches.open(APP_SHELL_CACHE).then((cache) => cache.put(request, clone));
      }
      return response;
    }).catch(() => {
      return caches.match(request);
    })
  );
});

// Listen for messages from the client (e.g., skipWaiting)
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
