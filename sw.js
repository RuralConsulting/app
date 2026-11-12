// Service worker: makes the app installable and quick to start. Caches only the app's own files (this site);
// never farm data, sign-in, map tiles or the signed links to published map files (all other origins pass straight through). VERSION is set by build.sh.
// PERF2: build.sh renames every script, stylesheet, font, icon and the manifest to name.<hash8>.ext (hash8 = its content) and
// rewrites SHELL to those names, so a name in SHELL always means the same bytes. A new version's install copies each SHELL
// entry the older caches already hold and fetches only the rest; activating keeps the newest older cache (for tabs still open
// on the old file names) and deletes the others, so a changed file's old name goes one version later. FLOATING files are fetched by a fixed name (the
// page, the kind registry LK4 reads, the privacy and terms note V8 reads, the demo's two files) and are fetched afresh by every version.
// APP names this app's caches: only caches that start with it are cleared on activate. The capture queue (capture-queue.js)
// is the page's IndexedDB, not a cache: a new version activating never touches it, so what waits to upload survives it.
const VERSION = "202611121850-d176602";
const APP = "fp-app";
const CACHE = `${APP}-${VERSION}`;
const FLOATING = ["./", "index.html", "layer-kinds.json", "privacy-terms.md", "demo/demo-farm.json", "demo/source.html"];
const SHELL = ["css/tokens.2379e305.css", "css/app.c00335d2.css", "manifest.8f6852ba.webmanifest",
  "js/consent-no.711a9161.js", "js/demo.5242d531.js", "css/demo.09842fda.css",
  "js/blocks/registry.108f6d88.js", "js/blocks/answer.ce39f59d.js", "js/blocks/map-scene.983486d2.js", "js/blocks/list.cce37062.js", "js/blocks/timeline.d3df4ebf.js", "js/blocks/checklist.956251f9.js", "js/blocks/gallery.a50a6865.js", "css/blocks.8ac4dcd2.css", "css/gallery.e67863d6.css", "js/plans/render.744f9380.js", "js/plans/demo.0d0eeef6.js", "js/plans/draft.2b379004.js", "css/plan-print.ac7ecabf.css", "css/plans-demo.04d0dd02.css", "js/farm-model.235078aa.js", "js/classify.e399e148.js", "js/blocks/documents.c853106d.js", "js/document-files.c4ac637b.js", "js/blocks/chart.0d3f074e.js", "js/wq-model.4f98ad86.js", "js/provenance-model.d43ee00f.js", "js/provenance-view.a1397604.js", "js/wq.37d54d0e.js","js/demo-documents.6bf46a91.js", "js/consent-conditions.5810278d.js", "js/wq-import.72949b21.js", "js/wq-analysis.ce793178.js", "js/ask.a4dbc8f6.js", "js/block-model.442f7f01.js", "js/add-block.8917b951.js", "js/decision-card-model.c452574d.js", "js/decision-card.2f57af07.js", "js/onboarding-model.a6e70f01.js", "js/onboarding.ce2f6fd3.js", "js/farm-reference.44ef4bd8.js", "js/farm-space.cfb0bd5e.js", "css/farm-space.d71cb8e1.css", "js/group-model.54ec22e8.js", "js/group-update.0bd365c9.js", "js/group-wq-answer.7133bd52.js", "js/group-manage-model.b3d694fa.js", "js/group-manage.73b21940.js", "js/group-layers.76cf63c1.js", "js/events-model.2753e2cd.js", "js/events.71b7d11f.js", "css/events.55f01c0d.css", "js/people-model.2797abe7.js", "js/review-items-model.67761b14.js", "js/review-items.1c1ac6b4.js", "js/subgroups.d189db45.js", "js/membership-model.baa23e78.js", "js/membership.ebab1026.js", "js/people.5be44311.js", "css/people.a13a7ac2.css", "js/place-home-model.94bb4749.js", "js/place-home.35f48e85.js", "css/place-home.c807a616.css", "js/group-space.a3c7a634.js", "js/shape-edit-model.ae81c31a.js", "js/shape-editor.0ee097ec.js", "css/group-space.ba8a4945.css", "js/wq-sites-model.97e120be.js", "js/wq-sites.df1b0ed0.js", "js/viewer.269d4a07.js", "js/maps-view.089bad01.js", "js/home-model.1a00756f.js", "js/home.1432d2bd.js", "css/maps.f2db5ced.css",
  "js/guard.7f69455e.js", "js/config.a14912fe.js", "js/brand.80965af9.js", "js/util.1d5eb095.js", "js/icons.d9c59684.js", "js/account-menu.0f64e677.js", "js/sheet.f9b10d89.js", "js/space-nav.9a24ed54.js", "js/map-palette.611ef9f6.js", "js/add.c5f65358.js", "css/ui.2a7e9921.css", "js/simple-view.d82f2668.js", "js/privacy.2bf69cda.js", "js/layer-kinds.f0f86f81.js", "js/route-timing.eb451185.js", "js/qml.5b2c66e1.js", "js/layer-style.be9878e2.js", "js/basemaps.53fc74c9.js", "js/auth.1e4f2997.js", "js/photo-model.7d519141.js", "js/capture-queue.3f5954df.js", "js/capture.e22e7bbe.js", "js/popup.02390ce3.js", "js/ops-model.432d61f3.js", "js/ops.bf82c038.js", "js/layer-notes-model.37f62a4d.js", "js/ops-layers.4df67f78.js", "js/looks-model.63776d70.js", "js/ops-looks.d52bb32b.js", "js/tokens-model.c6a721ec.js", "js/tokens.368b3ae6.js", "js/two-factor.a22a65e5.js", "css/ops.7e44c4d5.css", "js/main.d74cd888.js",
  "vendor/supabase.d6a5c441.js", "vendor/maplibre-gl-csp.a1f1847b.js", "vendor/maplibre-gl-csp-worker.f950e7b1.js", "vendor/maplibre-gl.ab1e70d5.css", "vendor/pmtiles.caf981bc.js", "vendor/viewer.374d7780.css",
  "fonts/source-sans-3-latin-ext-wght-normal.a85a7459.woff2", "fonts/source-sans-3-latin-wght-normal.19143dca.woff2", "fonts/source-serif-4-latin-ext-wght-normal.d10ccbbd.woff2", "fonts/source-serif-4-latin-wght-normal.382475f3.woff2",
  "brand/logo.a1046e5e.png", "brand/logo-dark.81183d54.png", "brand/icon.670b09db.png", "brand/icon-192.26ee2815.png", "brand/mccc-logo.e9d6f07b.png"];

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



