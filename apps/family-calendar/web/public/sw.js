/**
 * Service worker.
 *
 * Its whole job is making the app open with no signal. It deliberately does
 * NOT cache API responses: the app already keeps its last snapshot in
 * localStorage and knows how to say "offline — saved at 4pm". A second, silent
 * cache in front of the API would let a stale week look live, which is worse
 * than an honest offline badge.
 *
 * Bump CACHE when the shell changes; old caches are dropped on activate.
 */

const CACHE = 'family-calendar-v1';

/** Files worth having before the first offline load. */
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Individually, so one missing file cannot fail the whole install.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // the API and ntfy are not ours to cache
  if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') return;

  // Navigations: try the network so a deployed update is picked up, and fall
  // back to the cached shell when there is nothing to reach.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html').then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Everything else is a hashed build asset: serve it from the cache and
  // refresh it in the background.
  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => hit ?? Response.error());
      return hit ?? network;
    }),
  );
});
