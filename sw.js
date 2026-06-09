// Service Worker — نظام إدارة مصنع الألبان
const CACHE_NAME = 'dairy-v1.0';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/main.css',
  '/js/firebase.js',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;600;700;900&family=Tajawal:wght@300;400;500;700&display=swap',
];

// Install: cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS.filter(u => !u.startsWith('http'))))
      .then(() => self.skipWaiting())
  );
});

// Activate: remove old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: cache-first for static, network-first for Firebase
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET and Firebase requests (real-time DB)
  if (event.request.method !== 'GET') return;
  if (url.hostname.includes('firebase') || url.hostname.includes('googleapis.com')) return;

  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (!response || response.status !== 200 || response.type === 'opaque') return response;
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          return response;
        });
      })
      .catch(() => caches.match('/index.html'))
  );
});

// Background sync (for offline queue)
self.addEventListener('sync', event => {
  if (event.tag === 'dairy-sync') {
    event.waitUntil(
      self.clients.matchAll().then(clients => {
        clients.forEach(c => c.postMessage({ type: 'sync' }));
      })
    );
  }
});
