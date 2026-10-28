// Service worker: makes the app installable and quick to start. Caches only the app's own files (this site);
// never farm data, sign-in or map tiles (all other origins pass straight through). VERSION is set by build.sh.
const VERSION = "202610281925-48aa0c6";
const CACHE = `fp-app-${VERSION}`;
const SHELL = ["./", "index.html", "css/tokens.css", "css/app.css", "manifest.webmanifest",
  "js/demo.js", "css/demo.css", "demo/cairnvale-pdm.json", "demo/source.html",
  "js/answer.js", "css/answer.css", "js/farm-model.js", "js/farm-space.js", "css/farm-space.css",
  "css/plan.css", "js/plan/provenance.js", "js/plan/value.js", "js/plan/markdown.js",
  "js/plan/templates/fep_canterbury.js", "js/plan/templates/labels.js", "js/plan/render.js", "js/plan/audits.js", "js/plan/main.js",
  "js/guard.js", "js/config.js", "js/util.js", "js/qml.js", "js/basemaps.js", "js/auth.js", "js/popup.js", "js/farm-map.js", "js/main.js",
  "vendor/supabase.js", "vendor/maplibre-gl-csp.js", "vendor/maplibre-gl-csp-worker.js", "vendor/maplibre-gl.css",
  "fonts/source-sans-3-latin-ext-wght-normal.woff2", "fonts/source-sans-3-latin-wght-normal.woff2", "fonts/source-serif-4-latin-ext-wght-normal.woff2", "fonts/source-serif-4-latin-wght-normal.woff2",
  "brand/logo.png", "brand/logo-dark.png", "brand/icon.png", "brand/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // the page: network first, so a new version shows on the next open; cached copy if there's no coverage
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match("index.html")));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});



