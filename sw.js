// Service worker: makes the app installable and quick to start. Caches only the app's own files (this site);
// never farm data, sign-in or map tiles (all other origins pass straight through). VERSION is set by build.sh.
// PERF2: build.sh renames every script, stylesheet, font, icon and the manifest to name.<hash8>.ext (hash8 = its content) and
// rewrites SHELL to those names, so a name in SHELL always means the same bytes. A new version's install copies each SHELL
// entry the older caches already hold and fetches only the rest; activating keeps the newest older cache (for tabs still open
// on the old file names) and deletes the others, so a changed file's old name goes one version later. FLOATING files are fetched by a fixed name (the
// page, the demo's two files) and are fetched afresh by every version.
// APP names this app's caches: only caches that start with it are cleared on activate. The capture queue (capture-queue.js)
// is the page's IndexedDB, not a cache: a new version activating never touches it, so what waits to upload survives it.
const VERSION = "202611062004-e63e026";
const APP = "fp-app";
const CACHE = `${APP}-${VERSION}`;
const FLOATING = ["./", "index.html", "demo/demo-farm.json", "demo/source.html"];
const SHELL = ["css/tokens.e94af1dc.css", "css/app.e2bb8a1e.css", "manifest.8f6852ba.webmanifest",
  "js/consent-no.711a9161.js", "js/demo.49388451.js", "css/demo.615f29e6.css",
  "js/blocks/registry.108f6d88.js", "js/blocks/answer.ce39f59d.js", "js/blocks/map-scene.1b25cb02.js", "js/blocks/list.ecfce221.js", "js/blocks/timeline.d3df4ebf.js", "js/blocks/checklist.956251f9.js", "js/blocks/gallery.dd96d5f7.js", "css/blocks.cd0d5e92.css", "css/gallery.e67863d6.css", "js/plans/render.231dd46e.js", "js/plans/demo.2eb6773a.js", "js/plans/draft.ccbcfcaf.js", "css/plan-print.2d04ac8e.css", "css/plans-demo.04d0dd02.css", "js/farm-model.5c75a5ad.js", "js/classify.c416566e.js", "js/blocks/documents.768051d7.js", "js/blocks/chart.db462a2e.js", "js/wq-model.4f98ad86.js", "js/provenance-model.d43ee00f.js", "js/provenance-view.a1397604.js", "js/wq.6fbd9b35.js","js/demo-documents.6bf46a91.js", "js/consent-conditions.6b0d8590.js", "js/wq-import.72949b21.js", "js/wq-analysis.ce793178.js", "js/ask.a4dbc8f6.js", "js/block-model.9536f147.js", "js/add-block.b10a1af6.js", "js/decision-card-model.994fa1d0.js", "js/decision-card.4e3bde03.js", "js/onboarding-model.b131f7fa.js", "js/onboarding.4615fec7.js", "js/farm-reference.44ef4bd8.js", "js/farm-space.378095cc.js", "css/farm-space.5ba2a20f.css", "js/group-model.973b37ed.js", "js/group-update.7493b872.js", "js/group-wq-answer.7133bd52.js", "js/group-manage-model.243d6c7e.js", "js/group-manage.893da31f.js", "js/group-layers.9175a76e.js", "js/group-space.a9397c40.js", "css/group-space.28cb095b.css",
  "js/guard.7f69455e.js", "js/config.516a335a.js", "js/brand.80965af9.js", "js/util.1d5eb095.js", "js/route-timing.eb451185.js", "js/qml.cea07d44.js", "js/layer-style.974b8f6b.js", "js/basemaps.c59f15b8.js", "js/auth.1e4f2997.js", "js/photo-model.7d519141.js", "js/capture-queue.3f5954df.js", "js/capture.e22e7bbe.js", "js/popup.bdd9b131.js", "js/ops-model.53057a2f.js", "js/ops.4f467567.js", "js/layer-notes-model.37f62a4d.js", "js/ops-layers.12da861f.js", "css/ops.28daa0cf.css", "js/main.4022731e.js",
  "vendor/supabase.d6a5c441.js", "vendor/maplibre-gl-csp.a1f1847b.js", "vendor/maplibre-gl-csp-worker.f950e7b1.js", "vendor/maplibre-gl.ab1e70d5.css",
  "fonts/source-sans-3-latin-ext-wght-normal.a85a7459.woff2", "fonts/source-sans-3-latin-wght-normal.19143dca.woff2", "fonts/source-serif-4-latin-ext-wght-normal.d10ccbbd.woff2", "fonts/source-serif-4-latin-wght-normal.382475f3.woff2",
  "brand/logo.a1046e5e.png", "brand/logo-dark.81183d54.png", "brand/icon.670b09db.png", "brand/icon-192.26ee2815.png"];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    const older = (await caches.keys()).filter((k) => k.startsWith(APP + "-") && k !== CACHE);
    const missing = [];
    for (const url of SHELL) {
      let hit = null;
      for (const k of older) { hit = await (await caches.open(k)).match(url); if (hit) break; }
      if (hit) await c.put(url, hit); else missing.push(url);
    }
    await c.addAll([...missing, ...FLOATING].map((u) => new Request(u, { cache: "reload" })));
    await self.skipWaiting();
  })());
});
// activate keeps the newest older cache (names sort by build time) and deletes the rest: a tab opened before this publish still
// names the old files, and until it reloads its lazy requests (the map's worker script, a font) are answered from that cache
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => {
    const older = keys.filter((k) => k.startsWith(APP + "-") && k !== CACHE).sort();
    return Promise.all(older.slice(0, -1).map((k) => caches.delete(k)));
  }).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // the page: network first (revalidated, so a copy the host let the browser keep for ten minutes is never an old page naming files
  // the publish has since removed), so a new version shows on the next open; cached copy if there's no coverage
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request, { cache: "no-cache" }).catch(() => caches.open(CACHE).then((c) => c.match("index.html"))));
    return;
  }
  // this version's cache, then the kept older cache (an open tab's old file names), then the network
  e.respondWith((async () => {
    const hit = await (await caches.open(CACHE)).match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    const older = (await caches.keys()).filter((k) => k.startsWith(APP + "-") && k !== CACHE).sort().reverse();
    for (const k of older) {
      const old = await (await caches.open(k)).match(e.request, { ignoreSearch: true });
      if (old) return old;
    }
    return fetch(e.request);
  })());
});



