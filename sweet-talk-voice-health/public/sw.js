/* Sweet Talk service worker.
 *
 * Strategy (deliberately conservative for a health app):
 *   - Only GET requests are ever considered. Every POST — which is how all
 *     TanStack Start server functions and therefore every AI / data-mutation
 *     call travel — passes straight to the network, untouched.
 *   - Cross-origin requests (Mastra agents on Render, Anthropic/Groq, Supabase,
 *     Deepgram, Google Fonts) are never intercepted.
 *   - Same-origin hashed static assets (JS/CSS/fonts/images) → cache-first.
 *     Safe because Vite content-hashes these; a new deploy = new filenames.
 *   - Same-origin HTML navigations → network-first, with an offline fallback to
 *     the last cached shell, so the app still opens without a connection.
 *   - Anything else same-origin GET → straight to the network (never cached),
 *     which covers server-function GET RPC endpoints and /api/* just in case.
 *
 * Result: the app installs and launches fast, but no glucose reading, chat
 * reply, or alert is ever served from a stale cache.
 */

const VERSION = "sweet-talk-v1";
const RUNTIME = `${VERSION}-runtime`;

self.addEventListener("install", () => {
  // Activate this worker immediately on first install / update.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from previous versions.
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

const STATIC_ASSET = /\.(?:js|mjs|css|woff2?|ttf|otf|png|jpe?g|gif|svg|ico|webp|webmanifest)$/i;

function isStaticAsset(url) {
  return (
    STATIC_ASSET.test(url.pathname) ||
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/_build/")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Never touch non-GET (all server functions / AI calls are POST).
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Only handle our own origin. Everything cross-origin (AI providers,
  // Supabase, Deepgram, fonts) goes straight to the network.
  if (url.origin !== self.location.origin) return;

  // Belt-and-suspenders: never cache anything under /api/ or server-fn RPC.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_serverFn")) return;

  // Cache-first for content-hashed static assets.
  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const res = await fetch(request);
        if (res && res.ok && res.type === "basic") {
          const cache = await caches.open(RUNTIME);
          cache.put(request, res.clone());
        }
        return res;
      })(),
    );
    return;
  }

  // Network-first for page navigations; fall back to a cached shell offline.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          if (res && res.ok) {
            const cache = await caches.open(RUNTIME);
            cache.put(request, res.clone());
          }
          return res;
        } catch {
          const cached =
            (await caches.match(request)) || (await caches.match("/dashboard"));
          return cached || Response.error();
        }
      })(),
    );
    return;
  }

  // Any other same-origin GET: default to network, don't cache.
});
