// Service worker: makes the app installable and quick to start. Caches only the app's own files (this site);
// never farm data, sign-in or map tiles (all other origins pass straight through). VERSION is set by build.sh.
// APP names this app's caches; the sandbox build (sandbox.cjs) changes it, so the app at / and the one at /sandbox/
// (same site, so same cache storage) never read or delete each other's caches.
const VERSION = "202610301351-5fc21dc";
const APP = "fp-app";
const CACHE = `${APP}-${VERSION}`;
// The sandbox app lives under this one's folder; its own service worker handles it, this one never does.
const NESTED = new URL("sandbox/", self.registration.scope).pathname;
const SHELL = ["./", "index.html", "css/tokens.css", "css/app.css", "manifest.webmanifest",
  "js/demo.js", "css/demo.css", "demo/demo-farm.json", "demo/source.html",
  "js/blocks/registry.js", "js/blocks/answer.js", "js/blocks/map-scene.js", "js/blocks/list.js", "js/blocks/timeline.js", "js/blocks/checklist.js", "js/blocks/gallery.js", "css/blocks.css", "css/gallery.css", "js/plans/render.js", "js/plans/demo.js", "css/plan-print.css", "css/plans-demo.css", "js/farm-model.js", "js/classify.js", "js/blocks/documents.js", "js/demo-documents.js", "js/farm-space.js", "css/farm-space.css",
  "js/guard.js", "js/config.js", "js/brand.js", "js/util.js", "js/qml.js", "js/basemaps.js", "js/auth.js", "js/photo-model.js", "js/popup.js", "js/ops-model.js", "js/ops.js", "css/ops.css", "js/main.js",
  "vendor/supabase.js", "vendor/maplibre-gl-csp.js", "vendor/maplibre-gl-csp-worker.js", "vendor/maplibre-gl.css",
  "fonts/source-sans-3-latin-ext-wght-normal.woff2", "fonts/source-sans-3-latin-wght-normal.woff2", "fonts/source-serif-4-latin-ext-wght-normal.woff2", "fonts/source-serif-4-latin-wght-normal.woff2",
  "brand/logo.png", "brand/logo-dark.png", "brand/icon.png", "brand/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith(APP + "-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith(NESTED)) return;
  // the page: network first, so a new version shows on the next open; cached copy if there's no coverage
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.open(CACHE).then((c) => c.match("index.html"))));
    return;
  }
  // a script/style stamped with another build's ?v= belongs to a different cache than this worker's: network only
  const v = url.searchParams.get("v");
  if (v && v !== VERSION) { e.respondWith(fetch(e.request)); return; }
  e.respondWith(caches.open(CACHE).then((c) => c.match(e.request, { ignoreSearch: true })).then((hit) => hit || fetch(e.request)));
});



