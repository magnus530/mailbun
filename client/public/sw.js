/* mailclient service worker.
 *
 * Strategy:
 *   - Pre-cache the app shell on install.
 *   - For navigation requests, serve from cache, falling back to network.
 *   - For /api/* requests, always go to the network (data is always live);
 *     if offline, the client receives a network error and shows offline UI.
 *   - For /api/attachments/*, allow stale-while-revalidate so previously-seen
 *     attachments still open offline.
 */

// Bump SHELL_CACHE whenever a pre-cached shell asset changes — it's served
// cache-first, so stale entries (e.g. an old icon.svg) otherwise persist.
const SHELL_CACHE = "mailbun-shell-v3";
const ATTACHMENTS_CACHE = "mailbun-attachments-v1";
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/icon.svg",
  "/logo.png",
  "/apple-touch-icon.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== ATTACHMENTS_CACHE).map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.pathname.startsWith("/api/attachments/")) {
    e.respondWith(staleWhileRevalidate(request, ATTACHMENTS_CACHE));
    return;
  }
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws")) {
    return; // network only
  }

  if (request.mode === "navigate") {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((r) => r ?? caches.match("/index.html"))),
    );
    return;
  }

  // Shell assets (icons, manifest) keep a stable filename with no content
  // hash, so a cache-first entry would pin the old bytes forever — changing
  // the icon wouldn't change its URL. Revalidate them in the background
  // instead: the user sees the cached copy now and the new one next load.
  if (SHELL_ASSETS.includes(url.pathname)) {
    e.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    return;
  }

  // Everything under /assets/ IS content-hashed by Vite, so a URL match
  // guarantees identical bytes — safe to serve cache-first indefinitely.
  e.respondWith(
    caches.match(request).then((cached) =>
      cached ?? fetch(request).then((res) => {
        if (res.ok && url.pathname.startsWith("/assets/")) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
        }
        return res;
      }),
    ),
  );
});

function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then((cache) =>
    cache.match(request).then((cached) => {
      const networkPromise = fetch(request)
        .then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached ?? networkPromise;
    }),
  );
}
