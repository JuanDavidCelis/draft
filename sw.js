const CACHE_NAME = 'voidkings-draft-lab-v0-8-2';
const CACHE_PREFIX = 'voidkings-draft-lab-';
const LEGACY_CACHE_PREFIXES = ['vhaeldron-draft-lab-', 'voidkings-draft-lab-'];
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/styles.css',
  './assets/js/app.js',
  './assets/js/catalog.js',
  './assets/js/draft-intel.js',
  './assets/js/series.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/voidkings-logo.svg'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Reload each app-shell file from the deployment; do not reuse a stale HTTP cache.
    await cache.addAll(APP_SHELL.map(path => new Request(path, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => LEGACY_CACHE_PREFIXES.some(prefix => key.startsWith(prefix)) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  // Never cache authentication or private state API responses.
  if (requestUrl.pathname.startsWith('/api/')) return;

  event.respondWith((async () => {
    const isNavigation = event.request.mode === 'navigate';
    const cached = await caches.match(event.request);
    if (cached && !isNavigation) return cached;
    try {
      const response = await fetch(event.request, isNavigation ? { cache: 'no-store' } : undefined);
      if (response && response.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      if (isNavigation) return caches.match('./index.html');
      return cached || new Response('', { status: 503, statusText: 'Offline' });
    }
  })());
});
