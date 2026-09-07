const CACHE_NAME = "fsy-kumasi-shell-v42";
// Release marker: Access operations v20 with calmer responsive rows, progressive setup disclosure
// and single-scroll task sheets. Access identity and permission behavior remains on v19.
// Deployment retry marker: production redeploy requested after Vercel rate-limit block.
// Historical Access operations v19 used email-first identity reconciliation with automatic staff backfill.
// Historical Access operations v18 and Access operations v17 remain covered by regressions.
// Historical shell markers: fsy-kumasi-shell-v41, fsy-kumasi-shell-v40, fsy-kumasi-shell-v39,
// fsy-kumasi-shell-v38, fsy-kumasi-shell-v37 and fsy-kumasi-shell-v36.
// Access + Assignments v15 and Housing workflow v14 remain part of this release.
const CORE_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/app-icon.svg",
  "/brand/2026-theme-identifier-full-color.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/", copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match("/").then((cached) => cached || Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      }).catch(() => cached || Response.error());
      return cached || network;
    }),
  );
});
