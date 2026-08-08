/**
 * Print Manager - Service Worker v2
 * Professional PWA with offline support and caching strategies
 */

const CACHE_NAME = "print-manager-v2";
const DYNAMIC_CACHE = "print-manager-dynamic-v1";

// App Shell - Core files needed for offline functionality
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./app.js",
  "./sw.js"
];

// Icon files to cache
const ICON_FILES = [
  "./icons/icon-72.png",
  "./icons/icon-96.png",
  "./icons/icon-128.png",
  "./icons/icon-144.png",
  "./icons/icon-152.png",
  "./icons/icon-192.png",
  "./icons/icon-384.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/favicon.png"
];

// CDN Libraries - External dependencies
const CDN_LIBS = [
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/mammoth.js/1.7.2/mammoth.browser.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"
];

// Install event - Cache App Shell
self.addEventListener("install", (event) => {
  console.log("[SW] Installing Print Manager v2...");
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log("[SW] Caching app shell");
        return cache.addAll(APP_SHELL);
      })
      .then(() => {
        // Cache icons in background
        return caches.open(CACHE_NAME).then((cache) => {
          return Promise.allSettled(
            ICON_FILES.map(url => 
              cache.add(url).catch(() => console.log(`[SW] Failed to cache: ${url}`))
            )
          );
        });
      })
      .then(() => {
        // Pre-cache CDN libraries (network-first for these)
        return caches.open(DYNAMIC_CACHE).then((cache) => {
          return Promise.allSettled(
            CDN_LIBS.map(url =>
              fetch(url)
                .then(response => {
                  if (response.ok) {
                    cache.put(url, response);
                  }
                })
                .catch(() => {})
            )
          );
        });
      })
      .then(() => {
        console.log("[SW] Install complete");
        return self.skipWaiting();
      })
      .catch((err) => {
        console.error("[SW] Install failed:", err);
      })
  );
});

// Activate event - Clean old caches
self.addEventListener("activate", (event) => {
  console.log("[SW] Activating Print Manager v2...");
  
  event.waitUntil(
    caches.keys()
      .then((keys) => {
        return Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME && key !== DYNAMIC_CACHE)
            .map((key) => {
              console.log(`[SW] Deleting old cache: ${key}`);
              return caches.delete(key);
            })
        );
      })
      .then(() => self.clients.claim())
      .then(() => console.log("[SW] Activation complete"))
  );
});

// Fetch event - Smart caching strategy
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== "GET") return;

  // Strategy 1: Same origin - Cache First, Network Fallback
  if (url.origin === self.location.origin) {
    // For navigation requests (HTML pages)
    if (request.mode === "navigate") {
      event.respondWith(
        fetch(request)
          .catch(() => caches.match("./index.html"))
      );
      return;
    }

    // For other same-origin requests - Cache First
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          // Update cache in background
          fetch(request)
            .then((response) => {
              if (response.ok) {
                caches.open(CACHE_NAME).then((cache) => cache.put(request, response));
              }
            })
            .catch(() => {});
          return cached;
        }

        // Not in cache, fetch from network
        return fetch(request)
          .then((response) => {
            if (!response || !response.ok) {
              throw new Error("Network response not ok");
            }

            // Clone and cache the response
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });

            return response;
          })
          .catch(() => {
            // Return a fallback for images
            if (request.headers.get("accept")?.includes("image")) {
              return new Response("", { status: 404 });
            }
            return new Response("Offline", { status: 503 });
          });
      })
    );
    return;
  }

  // Strategy 2: CDN libraries - Stale While Revalidate
  if (CDN_LIBS.some(lib => url.href.includes(new URL(lib).hostname))) {
    event.respondWith(
      caches.open(DYNAMIC_CACHE).then((cache) => {
        return cache.match(request).then((cached) => {
          const fetchPromise = fetch(request)
            .then((networkResponse) => {
              if (networkResponse.ok) {
                cache.put(request, networkResponse.clone());
              }
              return networkResponse;
            });

          // Return cached version immediately, update in background
          return cached || fetchPromise;
        });
      })
    );
    return;
  }

  // Strategy 3: Other cross-origin requests - Network Only
  event.respondWith(
    fetch(request)
      .catch(() => {
        // Try to serve from dynamic cache as last resort
        return caches.match(request);
      })
  );
});

// Handle messages from the app
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  
  if (event.data?.type === "GET_VERSION") {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
  
  if (event.data?.type === "CLEAR_CACHE") {
    caches.keys().then(keys => {
      keys.forEach(key => caches.delete(key));
    }).then(() => {
      event.ports[0].postMessage({ cleared: true });
    });
  }
});

// Background sync for print jobs (future feature)
self.addEventListener("sync", (event) => {
  if (event.tag === "print-queue-sync") {
    console.log("[SW] Syncing print queue...");
    // Future: Queue print jobs when offline
  }
});

// Push notifications (future feature)
self.addEventListener("push", (event) => {
  if (event.data) {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || "مدير الطباعة", {
        body: data.body || "",
        icon: "./icons/icon-192.png",
        badge: "./icons/icon-72.png",
        dir: "rtl",
        lang: "ar",
        vibrate: [100, 50, 100],
        data: data.data || {}
      })
    );
  }
});

// Notification click handler
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((clientList) => {
      // Focus existing window or open new one
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow("./index.html");
      }
    })
  );
});
