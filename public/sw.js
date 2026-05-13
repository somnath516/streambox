/**
 * Netflix-style PWA Service Worker
 * Fix: ensure admin pages like /upload.html never show stale cached content.
 */
const CACHE_NAME = 'streambox-v2';
const urlsToCache = [
  '/',
  '/style.css',
  '/netflix-ui.css',
  '/index.html',
  // Keep the existing behavior for player
  '/player.html?v=' + Date.now()
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Bypass cache for dynamic pages with params or admin
  if (url.search || url.pathname.includes('upload.html') || url.pathname.includes('database.html') || url.pathname.includes('remote.html')) {
    return fetch(event.request);
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});
