// Service worker: makes the app installable and quick to start. Caches only the app's own files (this site);
// never farm data, sign-in, map tiles or the signed links to published map files (all other origins pass straight through). VERSION is set by build.sh.
// PERF2: build.sh renames every script, stylesheet, font, icon and the manifest to name.<hash8>.ext (hash8 = its content) and
// rewrites SHELL to those names, so a name in SHELL always means the same bytes. A new version's install copies each SHELL
// entry the older caches already hold and fetches only the rest; activating keeps the newest older cache (for tabs still open
// on the old file names) and deletes the others, so a changed file's old name goes one version later. FLOATING files are fetched by a fixed name (the
// page, the kind registry LK4 reads, the privacy and terms note V8 reads, the demo's two files) and are fetched afresh by every version.
// APP names this app's caches: only caches that start with it are cleared on activate. The capture queue (capture-queue.js)
// is the page's IndexedDB, not a cache: a new version activating never touches it, so what waits to upload survives it.
// SI1 (sign-in first): the page registers this worker only once the sign-in form or first screen is up and the page is quiet
// (boot.js worker()), so its install never competes with them.
const VERSION = "202611171308-216a787";
const APP = "fp-app";
const CACHE = `${APP}-${VERSION}`;
const FLOATING = ["./", "index.html", "layer-kinds.json", "privacy-terms.md", "demo/demo-farm.json", "demo/source.html"];
const SHELL = ["css/tokens.26191707.css", "css/app-base.0a90b0e5.css", "css/app.0e810d94.css", "manifest.4006e3b5.webmanifest",
  "js/consent-no.711a9161.js", "js/demo.6190f8b4.js", "css/demo.09842fda.css",
  "js/blocks/registry.108f6d88.js", "js/blocks/answer.ce39f59d.js", "js/blocks/map-scene.4b102500.js", "js/blocks/list.cce37062.js", "js/blocks/timeline.d3df4ebf.js", "js/blocks/checklist.956251f9.js", "js/blocks/gallery.a50a6865.js", "css/blocks.3c7afb56.css", "css/gallery.e67863d6.css", "js/plans/render.744f9380.js", "js/plans/demo.0d0eeef6.js", "js/plans/draft.2b379004.js", "css/plan-print.ac7ecabf.css", "css/plans-demo.04d0dd02.css", "js/farm-model.5d9607b5.js", "js/classify.e399e148.js", "js/blocks/documents.b4475d99.js", "js/document-files.c1bb0218.js", "js/blocks/chart.eb7d58d2.js", "js/wq-model.475917b0.js", "js/provenance-model.d43ee00f.js", "js/provenance-view.a1397604.js", "js/wq.37d54d0e.js","js/demo-documents.6bf46a91.js", "js/consent-conditions.5810278d.js", "js/wq-import.72949b21.js", "js/wq-analysis.ce793178.js", "js/ask.a4dbc8f6.js", "js/block-model.442f7f01.js", "js/add-block.8917b951.js", "js/decision-card-model.c452574d.js", "js/decision-card.2f57af07.js", "js/onboarding-model.a6e70f01.js", "js/onboarding.0bd65249.js", "js/farm-reference.44ef4bd8.js", "js/farm-space.b5b4bd12.js", "css/farm-space.cd7fb848.css", "js/group-model.84668260.js", "js/group-update.0bd365c9.js", "js/group-wq-answer.4709145a.js", "js/group-manage-model.a67db552.js", "js/group-manage.400c80db.js", "js/group-access-model.d166af23.js", "js/group-access.2c7feff7.js", "js/group-layers.76cf63c1.js", "js/events-model.deba2ac7.js", "js/events.44d74340.js", "js/event-attendance-model.041e2b3a.js", "js/event-attendance.991b13ad.js", "css/events.7a2bb97b.css", "js/people-model.d08373f6.js", "js/review-items-model.89924369.js", "js/review-items.68d430b7.js", "js/subgroups.1a273017.js", "js/membership-model.baa23e78.js", "js/membership.ebab1026.js", "js/people.a167e3dc.js", "css/people.ef7bbfbb.css", "js/place-home-model.6244bc83.js", "js/place-home.063d6316.js", "js/working-notes.6acfaded.js", "css/place-home.d22f4513.css", "js/farm-plan-model.11fd08ea.js", "js/farm-plan.648d616e.js", "js/group-space.6017d3fa.js", "js/shape-edit-model.f4fd7629.js", "js/shape-editor.0969da45.js", "css/group-space.052ae539.css", "js/wq-sites-model.8a0a0a55.js", "js/wq-sites.a515a8bd.js", "js/share-save-model.61f8be4c.js", "js/share-save.b448bfe6.js", "css/share-save.5c779c76.css", "js/wq-page-model.fc44d3ad.js", "js/wq-page.e87edfd0.js", "js/wqsv.57d06b23.js", "css/wq-page.6a2f06a0.css", "js/wq-round-model.526b7a38.js", "js/wq-round.c9858897.js", "css/wq-round.1062cb45.css", "js/demo-wq-page.a8b05130.js", "js/viewer.269d4a07.js", "js/maps-view.100344f4.js", "js/map-edit-model.53e2f322.js", "js/map-edit.4ef43581.js", "css/map-edit.217bb217.css", "js/home-model.78027000.js", "js/home.ed1a91bb.js", "js/staff-home.5375b740.js", "css/staff-home.da1d17ac.css", "css/maps.242b3c5e.css",
  "js/group-overview-model.e22b5f0d.js", "js/map-keep.35d7dd09.js", "js/group-overview.62504db8.js", "css/group-overview.be4090d5.css",
  "js/guard.7f69455e.js", "js/boot.c6cb675a.js", "js/signin.59c973f3.js", "js/config.a14912fe.js", "js/brand.80965af9.js", "js/util.1d5eb095.js", "js/icons.a5c51569.js", "js/account-menu.0f64e677.js", "js/sheet.99705a4c.js", "js/form-rows.774cb66a.js", "js/space-nav.b910fb41.js", "js/map-palette.6b73e8a8.js", "js/add.37668745.js", "css/ui-base.2885480d.css", "css/ui.985c962a.css", "css/new-version.541cf0f9.css", "js/simple-view.027cc9b4.js", "js/privacy.6b656fd5.js", "js/layer-kinds.f0f86f81.js", "js/route-timing.eb451185.js", "js/qml.5b2c66e1.js", "js/layer-style.be9878e2.js", "js/basemaps.47e834c2.js", "js/map-handoff.e148bdfc.js", "js/auth.1e4f2997.js", "js/photo-model.7d519141.js", "js/photo-read.6c164874.js", "js/capture-queue.dd1bd2f1.js", "js/capture.cfd0bd2b.js", "js/capture-model.7987bfae.js", "js/capture-ring-model.d1a95745.js", "js/phone-model.9b1f6d52.js", "js/locate.31951666.js", "js/phone-area.171ad7f0.js", "js/capture-ring.b84ea47f.js", "js/capture-photo.3f3c1edf.js", "js/capture-library-model.34d656ed.js", "js/capture-library.b1515855.js", "js/records.08f9c30f.js", "css/capture.7bd87def.css", "js/projects-model.38f948b1.js", "js/projects.e0f342c5.js", "css/projects.c97282b4.css", "js/insights-model.8b2b9df0.js", "js/insights.f22bfe08.js", "css/insights.fec6ad14.css", "css/rows.121bd5a9.css", "js/popup.02390ce3.js", "js/ops-model.432d61f3.js", "js/ops.df3b3184.js", "js/layer-notes-model.37f62a4d.js", "js/ops-layers.6d83548a.js", "js/looks-model.63776d70.js", "js/ops-looks.d52bb32b.js", "js/tokens-model.c6a721ec.js", "js/tokens.368b3ae6.js", "js/two-factor.a22a65e5.js", "css/ops.7e44c4d5.css", "js/main.6165da77.js",
  "vendor/supabase.d6a5c441.js", "vendor/maplibre-gl-csp.a1f1847b.js", "vendor/maplibre-gl-csp-worker.f950e7b1.js", "vendor/maplibre-gl.ab1e70d5.css", "vendor/pmtiles.caf981bc.js", "vendor/viewer.374d7780.css",
  "fonts/source-sans-3-latin-ext-wght-normal.a85a7459.woff2", "fonts/source-sans-3-latin-wght-normal.19143dca.woff2", "fonts/source-serif-4-latin-ext-wght-normal.d10ccbbd.woff2", "fonts/source-serif-4-latin-wght-normal.382475f3.woff2",
  "brand/logo.a1046e5e.png", "brand/logo-dark.81183d54.png", "brand/icon.670b09db.png", "brand/icon-192.26ee2815.png", "brand/mccc-logo.e9d6f07b.png"];

// PERF3c (the first open after a publish): the page is answered from this version's cache at once (see "the page" below), so
// the open after a publish is as quick as any other and nothing the publish changed is downloaded by the page; the browser's
// own check of sw.js (made after every open, past its ten-minute copy) finds the new version, whose install below runs in the
// background and downloads each changed file once. It takes over the open tab when done (skipWaiting) and serves the next open.
// A cache is whole only once its page is in it: the page is put last, and only when every script and stylesheet it names is
// already there, so a page from another publish (a host copy not yet updated) never joins it. An install that fails deletes its
// own part-filled cache, and the version in use stays as it was, whole.
const PAGE = "index.html";
// the scripts and stylesheets a page names (content-hashed: name.<hash8>.ext), which the cache that keeps the page must hold
const named = (html) => [...new Set([...html.matchAll(/(?:src|href)="((?:js|css|vendor)\/[^"?#:]+\.[0-9a-f]{8}\.(?:js|css))"/g)].map((m) => m[1]))];
async function whole(name) { return !!(await (await caches.open(name)).match(PAGE)); }
self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    try {
      const older = (await caches.keys()).filter((k) => k.startsWith(APP + "-") && k !== CACHE).sort().reverse();
      const missing = [];
      for (const url of SHELL) {
        let hit = null;
        for (const k of older) { hit = await (await caches.open(k)).match(url); if (hit) break; }
        if (hit) await c.put(url, hit); else missing.push(url);
      }
      // SI1 (sign-in first): a shell name is one set of bytes, so a copy the browser already holds (the sign-in page's own files) is
      // used as it is; the floating files are fetched past the browser's copy, and the page once, for both its names, last
      const pages = FLOATING.filter((u) => u === "./" || u === PAGE);
      await c.addAll([...missing.map((u) => new Request(u)), ...FLOATING.filter((u) => !pages.includes(u)).map((u) => new Request(u, { cache: "reload" }))]);
      const page = await fetch(new Request(PAGE, { cache: "reload" }));
      // (PERF3e: a redirected answer kept for the page would be refused by the browser on every open, so it fails the install too)
      if (!page.ok || page.redirected) throw new Error(PAGE + ": " + (page.redirected ? "redirected" : page.status));
      for (const name of named(await page.clone().text())) if (!(await c.match(name))) throw new Error(PAGE + " names " + name + ", which this version does not hold");
      for (const u of pages.filter((u) => u !== PAGE)) await c.put(u, page.clone());
      await c.put(PAGE, page);
    } catch (err) {
      await caches.delete(CACHE);   // never a part-filled cache: the version in use stays whole, and the next open tries again
      throw err;
    }
    await self.skipWaiting();
  })());
});
// activate keeps the newest older cache that is whole (names sort by build time) and deletes the rest: a tab opened before this
// version took over still names the old files, and until it reloads its lazy requests (the map's worker script, a font) are
// answered from that cache. So at most two versions are kept once the new one is in use.
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const older = (await caches.keys()).filter((k) => k.startsWith(APP + "-") && k !== CACHE).sort();
    let keep = null;
    for (const k of [...older].reverse()) if (await whole(k)) { keep = k; break; }
    await Promise.all(older.filter((k) => k !== keep).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});
// SH1: Android's Share. The installed app is a share target (manifest.webmanifest share_target): photos shared from the gallery or
// WhatsApp arrive as a form POST to ./share-target, which no server answers. They are kept in a cache of their own (SHARE: not named
// like this app's versioned caches, so activating a new version never clears it, and nothing here reads it) and the app opens at
// ./?shared=1; once the person is signed in, capture-library.js reads them once, clears the cache, and shows its review screen.
// Anything that goes wrong still opens the app (at ?shared=0), so a share never leaves the person on an error page.
// SH1b: the photos are tied to whoever was last signed in on this phone when they arrived (WHO: a one-entry cache the page writes at
// each sign-in and clears at sign-out; the index's `for`, or null when nobody was). Only that person is shown them; when nobody was
// signed in, only a sign-in within SHARE_WAIT (capture-library-model.js shareFor). Opening the app drops a share past its time unseen.
const SHARE = "fp-share-in", SHARE_MAX = 20, WHO = "fp-share-who";
const SHARE_WAIT = 10 * 60 * 1000, SHARE_AGE = 24 * 3600 * 1000;
async function signedInHere() {
  try {
    const r = await (await caches.open(WHO)).match("who");
    const v = r ? await r.json() : null;
    return v && typeof v.id === "string" && v.id ? v.id : null;
  } catch { return null; }
}
// a share no one may see any more (nobody was signed in and SHARE_WAIT has passed, or past SHARE_AGE, or unreadable): deleted
async function dropStaleShare() {
  try {
    if (!(await caches.has(SHARE))) return;
    const r = await (await caches.open(SHARE)).match("share-in/index");
    let idx = null;
    try { idx = r ? await r.json() : null; } catch { idx = null; }
    const age = idx && Number.isFinite(idx.at) ? Date.now() - idx.at : Infinity;
    if (!idx || age > (idx.for ? SHARE_AGE : SHARE_WAIT) || age < -60000) await caches.delete(SHARE);
  } catch { /* nothing to drop */ }
}
async function takeShare(request) {
  const back = (n) => Response.redirect(new URL("./?shared=" + n, self.registration.scope).href, 303);
  try {
    const form = await request.formData();
    const files = form.getAll("photos").filter((f) => f && typeof f === "object" && typeof f.size === "number" && f.size > 0).slice(0, SHARE_MAX);
    await caches.delete(SHARE);
    if (!files.length) return back(0);
    const who = await signedInHere();
    const c = await caches.open(SHARE), list = [];
    for (const [i, f] of files.entries()) {
      const key = "share-in/" + i;
      await c.put(key, new Response(f, { headers: { "content-type": f.type || "application/octet-stream" } }));
      list.push({ key, name: String(f.name || ""), type: String(f.type || ""), size: f.size, modified: Number.isFinite(f.lastModified) ? f.lastModified : null });
    }
    await c.put("share-in/index", new Response(JSON.stringify({ at: Date.now(), for: who, files: list }), { headers: { "content-type": "application/json" } }));
    return back(list.length);
  } catch { return back(0); }
}
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === "POST" && url.origin === location.origin && /\/share-target$/.test(url.pathname)) { e.respondWith(takeShare(e.request)); return; }
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // the page (PERF3c): this version's own copy at once, with no network, so the app it names is the one this cache holds, whole,
  // and a slow or absent signal never holds the first screen up. A new version is found by the browser's own check of sw.js and
  // installs in the background (above); it is used from the next open. Only when this cache has no page (it never should, once
  // this worker is in use) is the page fetched, past the browser's ten-minute copy. Any other page of the site: network first.
  if (e.request.mode === "navigate") {
    e.waitUntil?.(dropStaleShare());   // (SH1b: a share past its time is never kept)
    const scope = new URL(self.registration.scope).pathname, app = url.pathname === scope || url.pathname === scope + PAGE;
    const own = async () => ((await caches.has(CACHE)) ? (await caches.open(CACHE)).match(PAGE) : undefined);
    e.respondWith((async () => {
      const kept = app ? await own() : undefined;
      if (kept) return kept;
      return fetch(e.request, { cache: "no-cache" }).catch(own);
    })());
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



