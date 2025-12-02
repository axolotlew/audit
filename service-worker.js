/*
 * Simple service worker for offline caching of static assets.
 *
 * This script caches the core application shell during installation and
 * attempts to serve cached responses for navigations and asset requests
 * while falling back to the network when necessary. Note that requests to
 * third‑party CDNs may not be cacheable due to CORS restrictions.
 */

const CACHE_NAME = 'schedule-pwa-v1';
const ASSETS = [
  '.',
  'index.html',
  'style.css',
  'script.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Only handle GET requests
  if (request.method !== 'GET') return;
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(request)
        .then((response) => {
          // Cache the response if it's a same-origin request
          const url = new URL(request.url);
          if (url.origin === location.origin) {
            return caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, response.clone());
              return response;
            });
          }
          return response;
        })
        .catch(() => {
          // If network fetch fails, return a generic fallback for navigation requests
          if (request.mode === 'navigate') {
            return caches.match('index.html');
          }
        });
    })
  );
});