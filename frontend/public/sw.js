// Service worker for the mobile-companion PWA.
// Strategy:
//   /api/*       network-only — encrypted journal data must never be cached.
//   /assets/*    cache-first — Vite-fingerprinted bundles are immutable.
//   /            stale-while-revalidate — keep the shell installable offline.
// We deliberately avoid caching the IndexedDB outbox here; that's owned by
// the page layer (mobileOutbox.ts) so cache wipes don't drop user content.

const SHELL_CACHE = "diary-shell-v1";
const ASSET_CACHE = "diary-assets-v1";
const SHELL_URLS = [
  "/",
  "/manifest.json",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    return; // network-only by default
  }
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const resp = await fetch(req);
        if (resp.ok) cache.put(req, resp.clone());
        return resp;
      })
    );
    return;
  }

  // Stale-while-revalidate for HTML / icons / manifest.
  event.respondWith(
    caches.open(SHELL_CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      const fetcher = fetch(req)
        .then((resp) => {
          if (resp.ok) cache.put(req, resp.clone());
          return resp;
        })
        .catch(() => hit || new Response("offline", { status: 503 }));
      return hit || fetcher;
    })
  );
});
