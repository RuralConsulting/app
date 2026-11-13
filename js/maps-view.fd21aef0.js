// V4: Maps, in the farm and group spaces. Published maps (V1's published_maps and map_packages, the private map-packages bucket)
// shown with the portal's viewer (js/viewer.js), as portal/portal.js does: read the current package, sign its file links, mount.
// Every read is the signed-in person's, under V1's policies: the owner's members only. A person who is not a member reads no
// map, so no file is signed and the viewer is never started. Only maps not archived and with a current package are listed.
// Signed links last an hour. They are renewed ten minutes before they run out, by drawing the map again where it was; a tab that
// slept past that renews when it is looked at again. If renewing fails, the map goes and the person is told plainly.
// Client suggestions are off in v1: the viewer is given no `suggest`. farm-space.js and group-space.js only say when to open and close.
// CL1: every map offers the reference layers (roads, waterways) stored once on the platform under core/, signed and renewed with the
// map's own files and passed as the viewer's referenceLayers; one whose file is not there is left out and the map opens without it.
// CL2: so is every core layer marked to be offered on every map with its own style (tools/load_core_reference.py --batch).
// N2: each map drawn is given the water quality sites overlay (js/wq-sites.js): a "Water quality" button on the map the viewer
// returns, the sites of this farm or group, and a panel for a site or a comparison. What the person had open is kept while the
// links are renewed (the map is drawn again where it was). An overlay that fails to start leaves the map as it is.
// N2b: the map's bounds go with it: a group the old model has no area for lists the shared sites inside its published map.
// CTX2: on a group's map, the context layers the loader marked starts_on (native vegetation, protected places) are on as it first
// opens on a device; a farm's map starts them all off, as before.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; return; }
  root.FP = root.FP || {};
  const FP = root.FP, BASEMAP_KEY = "rv-basemap";
  const linzKey = () => (FP.demo?.active || typeof FP_CONFIG === "undefined" ? null : FP_CONFIG.linzKey);
  // The viewer reads the person's remembered background as it starts. With no LINZ key (the demo) nothing is to be fetched,
  // so it starts on None; what the person had remembered is put back at once.
  // CTX2: a context layer marked startOn (a group's map, tools/core_layers/layers.json "starts_on") is on as the map opens unless the
  // person has switched it on or off on this device before: the viewer reads its remembered switch ("rv-ctx-<key>") only as it
  // starts, so it is set for the start and taken away again; once the person switches it, the viewer remembers their choice.
  function mount(holder, options) {
    let store = null;
    try { store = localStorage; } catch {}
    const { phoneGroup = false, ...rest } = options;
    return api.seedStartOn(store, rest.referenceLayers, () => mountWith(holder, rest), { phoneGroup });
  }
  const phone = () => !!root.matchMedia?.("(max-width: 720px)").matches;   // the viewer's own phone width
  // PH2: what the app sets around the viewer's own controls on a phone (viewer.js is the portal's and is not edited): one "More"
  // control after Locate holds zoom, the compass, 3D, measure and print (shown by maps.css while it is open); the credit starts
  // folded to its "i"; a group's map fits "Whole area" (not "Whole property") and its line says when it was published, not surveyed.
  function chrome(map, holder, { group = false, publishedAt = null, areaHa = null } = {}) {
    const el = (...a) => FP.el(...a);
    if (group) {
      const fit = holder.querySelector(".rv-fit");
      if (fit) fit.textContent = "Whole area";
      const line = holder.querySelector(".rv-meta");
      if (line) line.textContent = api.meta({ publishedAt, areaHa });
    }
    FP.basemaps?.quietCredit?.(map);
    const button = el("button", { type: "button", class: "ph-more-btn", "aria-expanded": "false", "aria-label": "More map tools", title: "More map tools" }, FP.icon ? FP.icon("more", 20) : "…");
    const box = el("div", { class: "maplibregl-ctrl maplibregl-ctrl-group ph-more" }, button);
    const more = (on) => { holder.classList.toggle("ph-more-open", on); button.setAttribute("aria-expanded", String(on)); };
    button.addEventListener("click", () => more(!holder.classList.contains("ph-more-open")));
    // a tool that takes over the map (3D, measure, print, compare) closes the list; zoom keeps it open for another tap
    holder.addEventListener("click", (e) => { if (e.target.closest?.(".rv-3d button, .rv-tools button")) more(false); });
    try { map.addControl({ onAdd: () => box, onRemove: () => box.remove() }, "top-right"); } catch {}
    try { map.addControl({ onAdd: () => locateControl(map), onRemove: () => {} }, "top-right"); } catch {}
  }
  // review of #538, 4: Locate me on a phone's map is the app's own, as on Home (the viewer's is MapLibre's, which a permission query
  // saying "denied" turns off for good and which says nothing when refused): the phone is asked from the tap itself, the real answer
  // decides, and a refusal says where this phone turns location on, with Try again (which asks again from its own tap). On a
  // computer the viewer's own control stays (maps.css shows one or the other).
  function locateControl(map) {
    const el = (...a) => FP.el(...a), P = FP.phoneModel;
    const btn = el("button", { type: "button", class: "ph-locate-btn", "aria-label": "Locate me", title: "Locate me" }, FP.icon ? FP.icon("locate", 20) : "◎");
    const box = el("div", { class: "maplibregl-ctrl maplibregl-ctrl-group ph-locate" }, btn);
    let marker = null;
    const refused = (problem) => FP.sheet?.open({ opener: btn, title: "Location", className: "ph-locate-sheet", body: (done) => [
      el("p", { class: "ph-locate-say", role: "alert" }, problem.text),
      ...(problem.help?.length ? [el("ol", { class: "qp-help ph-locate-help" }, ...problem.help.map((h) => el("li", {}, h)))] : []),
      el("div", { class: "qp-set", role: "group" }, el("button", { type: "button", class: "qp-row", id: "ph-locate-retry", onclick: () => { done(); ask(); } },
        el("span", { class: "qp-dot", "aria-hidden": "true" }, FP.icon ? FP.icon("locate", 20) : null), el("span", {}, "Try again"))),
    ] });
    function ask() {
      if (!FP.locate || !P) return;
      const asked = FP.locate.get({ maxAge: 5000 });   // (from the tap itself: nothing awaited first)
      btn.classList.add("ph-busy"); btn.setAttribute("aria-busy", "true");
      asked.then((got) => {
        btn.classList.remove("ph-busy"); btn.removeAttribute("aria-busy");
        if (!got.ok) { btn.setAttribute("aria-pressed", "false"); refused(got.problem); return; }
        const f = got.fix, gl = root.maplibregl;
        btn.setAttribute("aria-pressed", "true");
        try {
          if (!marker && gl?.Marker) marker = new gl.Marker({ element: el("span", { class: "ph-me-dot", "aria-label": "You are here" }), anchor: "center" });
          marker?.setLngLat([f.lon, f.lat]).addTo(map);
          map.easeTo({ center: [f.lon, f.lat], zoom: Math.max(map.getZoom(), 14), duration: root.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 600 });
        } catch { /* the map is going */ }
      });
    }
    btn.addEventListener("click", ask);
    return box;
  }
  function mountWith(holder, options) {
    if (linzKey()) return root.RCLViewer.mount(holder, options);
    let was = null;
    try { was = localStorage.getItem(BASEMAP_KEY); localStorage.setItem(BASEMAP_KEY, "none"); } catch {}
    try { return root.RCLViewer.mount(holder, options); }
    finally { try { if (was === null) localStorage.removeItem(BASEMAP_KEY); else localStorage.setItem(BASEMAP_KEY, was); } catch {} }
  }
  FP.mapsView = api.create({
    sb: () => FP.sb, el: (...a) => FP.el(...a), mount, backgrounds: () => api.backgrounds(linzKey()),
    // The viewer's stylesheet sets page-wide rules and is on only while a map is shown (index.html loads it as media="not all").
    // Switching it on returns once it applies: the map takes its size from the holder as it starts, and before the stylesheet
    // is in, the viewer's map element has no height (MapLibre then makes a 300 px canvas and keeps it). Chrome reads the sheet
    // again when its media changes, so it applies only once the page's style sheets list it (checked every 16 ms, 4 s at most).
    phone, chrome,
    // PH2: a group's map's sub-groups in the soft neutral set (map-palette.js), and the names of the person's sub-groups to know them by
    calm: (manifest, owner) => {
      const group = !!(owner?.org && !owner.farm), css = typeof getComputedStyle === "function" ? getComputedStyle(document.documentElement) : null;
      let bm = null; try { bm = localStorage.getItem(BASEMAP_KEY); } catch {}
      const names = (FP.groupSpace?.groups?.() || []).filter((g) => g.parent_org_id === owner?.org).map((g) => String(g.name || "").trim().toLowerCase());
      return api.calmManifest(manifest, { group, palette: FP.mapPalette, names, onDark: (bm || (phone() && group ? "map" : "aerial")) === "aerial",
        hues: FP.mapPalette && css ? FP.mapPalette.hues((k) => css.getPropertyValue(k)) : null });
    },
    styles: (on) => {
      const link = document.querySelector("link[data-viewer-styles]");
      if (!link) return null;
      link.media = on ? "all" : "not all";
      const applies = () => !!link.sheet && [...document.styleSheets].includes(link.sheet);
      if (!on || applies()) return null;
      const until = Date.now() + 4000;
      return new Promise((done) => { (function tick() { if (applies() || Date.now() > until) done(); else setTimeout(tick, 16); })(); });
    },
    overlay: (map, holder, owner, state, bounds) => FP.wqSites?.attach({ map, holder, sb: FP.sb, owner, state, bounds }) || null,
    go: (hash) => { location.hash = hash; }, now: () => Date.now(), visible: () => document.visibilityState === "visible",
    setTimer: (f, ms) => setTimeout(f, ms), clearTimer: (t) => clearTimeout(t),
  });
  document.addEventListener("visibilitychange", () => FP.mapsView.wake());
})(typeof window === "undefined" ? globalThis : window, function () {
  const BUCKET = "map-packages";
  const MAX_MAPS = 100, SIGN_BATCH = 500, MAX_SHARED = 50, SHARED_PREFIX = "shared/";
  const MAX_REFERENCE = 40, REFERENCE_PREFIX = "reference/", REFERENCE_DRAWS = ["roads", "waterways"], CONTEXT_DRAW = "context";
  const LINK_SECONDS = 3600, RENEW_MS = (LINK_SECONDS - 600) * 1000;
  const NONE = "No maps have been published here yet.";
  const NONE_HINT = "Rural Consulting publishes maps here; each one appears as soon as it is ready.";
  const UNAVAILABLE = "This map is not available right now.";
  const RAN_OUT = "This map's links have run out and could not be renewed. Check your connection and try again.";
  const LINZ = "https://basemaps.linz.govt.nz/v1/tiles";
  const ATTRIBUTION = "LINZ CC BY 4.0 © Imagery Basemap contributors";

  // LINZ only: the app's content security policy allows no other tile provider, so the viewer's own Esri and S3 defaults are replaced.
  function backgrounds(key) {
    const tiles = (set, ext, extra = "") => [`${LINZ}/${set}/WebMercatorQuad/{z}/{x}/{y}.${ext}?api=${encodeURIComponent(key || "")}${extra}`];
    return {
      basemaps: { aerial: { label: "Aerial", tiles: tiles("aerial", "webp"), attribution: ATTRIBUTION, maxzoom: 22 },
        map: { label: "Map", tiles: tiles("topo-raster", "webp"), attribution: ATTRIBUTION, maxzoom: 18 } },
      terrain: { tiles: tiles("elevation", "png", "&pipeline=terrain-rgb"), encoding: "mapbox", attribution: ATTRIBUTION },
    };
  }

  // Which stored file each of the manifest's files is: by content (file_map), or <prefix>/<file> (as the portal reads a package).
  function filesByPath(manifest, prefix) {
    const byPath = new Map(), where = (rel) => manifest.file_map?.[rel] || prefix + "/" + rel;
    for (const rel of Array.isArray(manifest.files) ? manifest.files : []) byPath.set(where(rel), [...(byPath.get(where(rel)) || []), rel]);
    return byPath;
  }
  const day = (d) => (d ? new Date(d).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" }) : "");

  function create(env) {
    const { el } = env;
    let shown = null;

    // The owner's maps with a current package, by title (without the manifests, which are large).
    async function readMaps(owner) {
      const sb = env.sb();
      const maps = await sb.from("published_maps").select("id, slug, title, description, kind")
        .eq(owner.farm ? "farm_id" : "org_id", owner.farm || owner.org).is("archived_at", null).order("title").limit(MAX_MAPS);
      if (maps.error) throw maps.error;
      if (!maps.data?.length) return [];
      const current = await sb.from("map_packages").select("map_id, published_at").in("map_id", maps.data.map((m) => m.id)).eq("is_current", true).limit(MAX_MAPS);
      if (current.error) throw current.error;
      const published = new Map((current.data || []).map((p) => [p.map_id, p.published_at]));
      return maps.data.filter((m) => published.has(m.id)).map((m) => ({ ...m, published_at: published.get(m.id) }));
    }

    // UI2: the list is read once and kept for a minute, so a group's Overview (its "This group's map" card) and its Maps share one read
    const listed = new Map();
    function listMaps(owner) {
      const key = owner.farm ? "farm:" + owner.farm : "org:" + owner.org, t = env.now?.() ?? Date.now(), hit = listed.get(key);
      if (hit && t - hit.at < 60000) return hit.p;
      const p = readMaps(owner);
      listed.set(key, { at: t, p });
      p.catch(() => { if (listed.get(key)?.p === p) listed.delete(key); });
      return p;
    }

    // The map's current package and its signed links, or null when it has none the person may have.
    async function readPackage(map) {
      const sb = env.sb();
      const { data: pkg, error } = await sb.from("map_packages").select("manifest, storage_prefix").eq("map_id", map.id).eq("is_current", true).maybeSingle();
      if (error) throw error;
      if (!pkg) return null;
      const byPath = filesByPath(pkg.manifest, pkg.storage_prefix);
      const shared = await sharedLayers(sb, pkg.manifest, byPath);
      const reference = await referenceRows(sb, byPath);
      const paths = [...byPath.keys()], urls = {};
      for (let i = 0; i < paths.length; i += SIGN_BATCH) {
        const { data, error: refused } = await sb.storage.from(BUCKET).createSignedUrls(paths.slice(i, i + SIGN_BATCH), LINK_SECONDS);
        if (refused) throw refused;
        for (const d of data || []) if (d.signedUrl) for (const rel of byPath.get(d.path) || []) urls[rel] = d.signedUrl;
      }
      if (!Object.keys(urls).some((rel) => !rel.startsWith(SHARED_PREFIX) && !rel.startsWith(REFERENCE_PREFIX))) return null;   // none of the map's own files: as before
      // a layer whose tiles did not all get a link (removed, or the person may not have them) counts as missing: the viewer says so
      const usable = shared.map((L) => (L && [L.tiles, ...(L.tile_parts || []).map((p) => p.tiles)].every((f) => urls[f]) ? L : null));
      // a reference layer whose file did not get a link (not uploaded yet, or removed) is left out: the map opens without it
      const referenceLayers = reference.filter((r) => urls[r.rel]).map((r) => ({ key: r.key, title: r.title, credit: r.credit, url: urls[r.rel], ...(r.style ? { style: r.style } : {}),
        ...(r.group ? { group: r.group } : {}), ...(r.order !== undefined ? { order: r.order } : {}), ...(r.startsOn ? { startsOn: true } : {}) }));
      return { manifest: pkg.manifest, urls, shared: usable, referenceLayers };
    }

    // CL1: the reference layers, from the core register: the rows whose style names how the viewer draws them
    // ({ reference: { draw: "roads" | "waterways", credit } }, written by tools/load_core_reference.py), by key. Each row's one file
    // is signed with the map's own, so every map draws the same stored copy. A read that fails only leaves them out.
    // CL2: a row drawn as "context" and marked every_map carries its own style ({ source_layer, layers, legend }); it is offered by
    // its own key with that style, in the order the loader gave (tools/core_layers/layers.json), and the viewer lists it under
    // Context layers, off until switched on.
    // N1: with its theme (style.reference.group) and order, so the viewer lists it under that theme's heading, which folds.
    async function referenceRows(sb, byPath) {
      let rows = [];
      try {
        const { data, error } = await sb.from("core_layers").select("key, title, style, tiles_path").not("style->reference", "is", null).order("key").limit(MAX_REFERENCE);
        rows = error ? [] : data || [];
      } catch { rows = []; }
      // CL3: a row the loader marked offered false is withdrawn: neither listed nor signed (its file and row stay)
      const context = (ref) => ref?.draw === CONTEXT_DRAW && ref.every_map === true && ref.offered !== false && ref.style && typeof ref.style === "object" && !Array.isArray(ref.style);
      const order = (row) => (context(row.style.reference) ? (Number.isFinite(row.style.reference.order) ? row.style.reference.order : 1e6) : -1);
      return rows.filter((row) => ((REFERENCE_DRAWS.includes(row?.style?.reference?.draw) && row.style.reference.offered !== false) || context(row?.style?.reference)) && typeof row.tiles_path === "string" && row.tiles_path.startsWith("core/"))
        .sort((a, b) => order(a) - order(b))
        .map((row) => {
          const rel = REFERENCE_PREFIX + row.key, ref = row.style.reference;
          byPath.set(row.tiles_path, [...(byPath.get(row.tiles_path) || []), rel]);
          const credit = typeof ref.credit === "string" ? ref.credit : "";
          if (!context(ref)) return { rel, key: ref.draw, title: row.title, credit };
          // N1: its theme heading in the Layers panel and its place, from the loader (style.reference.group, .order)
          return { rel, key: row.key, title: row.title, credit, style: ref.style,
            ...(typeof ref.group === "string" && ref.group.trim() ? { group: ref.group.trim() } : {}),
            ...(Number.isFinite(ref.order) ? { order: ref.order } : {}),
            ...(ref.starts_on === true ? { startsOn: true } : {}) };     // CTX2: on as a group's map opens
        });
    }

    // The layers this map refers to (manifest.shared_layers: core or a group's), from the registers each by its key: one storage
    // path, signed like the map's own files, so every map that refers to a layer shares the one copy. A list the same length as the
    // references, null where a layer is not there; the viewer makes no database calls of its own. Row-level security decides what
    // the person may read of a group's register, and a read that fails only makes the layer missing.
    async function sharedLayers(sb, manifest, byPath) {
      const refs = Array.isArray(manifest.shared_layers) ? manifest.shared_layers.slice(0, MAX_SHARED) : [];
      if (!refs.length) return [];
      const rowsOf = async (query) => { try { const { data, error } = await query; return error ? [] : data || []; } catch { return []; } };
      const found = new Map(), wanted = (tier, org) => [...new Set(refs.filter((r) => r.tier === tier && (tier === "core" || r.org_id === org)).map((r) => r.key))];
      const core = wanted("core");
      if (core.length) for (const row of await rowsOf(sb.from("core_layers").select("key, title, style, tiles_path").in("key", core))) found.set("core:" + row.key, row);
      for (const org of new Set(refs.filter((r) => r.tier === "group").map((r) => r.org_id))) {
        for (const row of await rowsOf(sb.from("group_shared_layers").select("org_id, key, title, style, tiles_path").eq("org_id", org).in("key", wanted("group", org)))) found.set("group:" + org + ":" + row.key, row);
      }
      return refs.map((ref, i) => {
        const row = found.get(ref.tier === "group" ? "group:" + ref.org_id + ":" + ref.key : "core:" + ref.key);
        const layer = row && row.style && typeof row.style.layer === "object" ? row.style.layer : null;
        if (!layer || !row.tiles_path) return null;
        const folder = row.tiles_path.slice(0, row.tiles_path.lastIndexOf("/") + 1), base = SHARED_PREFIX + i + "/";
        const name = (file) => { byPath.set(folder + file, [...(byPath.get(folder + file) || []), base + file]); return base + file; };
        return { ...layer, id: "shared-" + i, title: row.title, tiles: name(row.tiles_path.slice(folder.length)),
          ...(Array.isArray(layer.tile_parts) ? { tile_parts: layer.tile_parts.map((p) => ({ ...p, tiles: name(p.tiles) })) } : {}),
          legend: Array.isArray(layer.legend) ? layer.legend.map((e) => (e.icon ? { ...e, icon: name(e.icon) } : e)) : [] };
      });
    }

    function dropMap(s) {
      env.clearTimer(s.timer); s.timer = null; s.renewAt = Infinity;
      try { s.overlay?.remove(); } catch {}
      s.overlay = null;
      try { s.map?.remove(); } catch {}
      s.map = null;
      env.styles(false);
    }
    function say(s, text, ...more) {
      dropMap(s);
      s.host.replaceChildren(el("div", { class: "maps-message", role: "status" }, el("p", {}, text), ...more));
    }
    const tryAgain = (s) => el("button", { type: "button", class: "maps-again", onclick: () => open(s.host, s.opts) }, "Try again");

    function list(s, maps) {
      dropMap(s);
      s.host.replaceChildren(el("section", { class: "maps-list" }, el("h2", {}, "Maps"),
        el("ul", {}, ...maps.map((m) => el("li", {}, el("a", { href: s.opts.href(m.id) }, globalThis.FP?.icon ? el("span", { class: "maps-thumb", "aria-hidden": "true" }, globalThis.FP.icon("maps", 30)) : null, el("b", {}, m.title),
          el("small", {}, [m.kind, m.published_at ? "Updated " + day(m.published_at) : ""].filter(Boolean).join(" · "))))))));
    }

    async function draw(s) {
      const renewing = !!s.map;
      if (!renewing) say(s, "Loading the map…");
      let read = null;
      try { read = await readPackage(s.chosen); } catch {}
      if (s !== shown) return;
      if (!read) { say(s, renewing ? RAN_OUT : UNAVAILABLE, tryAgain(s)); return; }
      const m = s.map, at = m && { center: m.getCenter(), zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() };
      dropMap(s);
      // the viewer's stylesheet on, and read, before the map is made (env.styles), so the map starts at its holder's full size
      try { await env.styles(true); } catch {}
      if (s !== shown) return;
      const holder = el("div", { class: "maps-viewer" });
      try {
        s.host.replaceChildren(holder);
        const group = !!(s.opts.owner?.org && !s.opts.owner.farm);
        const manifest = env.calm ? env.calm(read.manifest, s.opts.owner) : read.manifest;
        s.map = env.mount(holder, {
          manifest: { ...manifest, property: s.opts.name, title: s.chosen.title, map_title: s.chosen.title, description: s.chosen.description || "", kind: s.chosen.kind || "" },
          // (a legend swatch drawn here is an SVG data: image, passed as it is; every other file is a signed link)
          url: (rel) => (typeof rel === "string" && rel.startsWith("data:image/svg+xml,") ? rel : read.urls[rel] || ""),
          ...(group && env.phone?.() ? { phoneGroup: true } : {}),
          ...(read.shared.length ? { shared: read.shared } : {}),
          referenceLayers: startOn(read.referenceLayers, s.opts.owner),
          onBack: s.several ? () => env.go(s.opts.href(null)) : null, backLabel: "All maps",
          ...env.backgrounds(),
        });
        if (at) s.map.jumpTo(at);
        try { env.chrome?.(s.map, holder, { group, publishedAt: s.chosen.published_at, areaHa: read.manifest?.area_ha }); } catch {}
      } catch { say(s, UNAVAILABLE, tryAgain(s)); return; }
      try { s.overlay = env.overlay ? env.overlay(s.map, holder, s.opts.owner, s.wq, read.manifest?.bounds || null) : null; } catch { s.overlay = null; }
      s.renewAt = env.now() + RENEW_MS;
      s.timer = env.setTimer(wake, RENEW_MS);
    }

    // Renew the links once they are due, when the map is being looked at (a timer does not run in a sleeping tab).
    function wake() {
      const s = shown;
      if (!s?.map || !env.visible() || s.renewAt === Infinity) return undefined;
      const left = s.renewAt - env.now();
      if (left > 0) { env.clearTimer(s.timer); s.timer = env.setTimer(wake, left); return undefined; }   // the wall clock can be a little short when the timer fires
      s.renewAt = Infinity;
      return draw(s);
    }

    // host: the element to fill. opts: { owner: { farm } or { org }, name, item (a map's id, or none), href(mapId or null) }.
    async function open(host, opts) {
      close();
      // MC1: opts.waterQuality opens the map with its water quality sites panel on (the overview's "Open water quality")
      const s = shown = { host, opts, map: null, timer: null, renewAt: Infinity, chosen: null, several: false, overlay: null, wq: opts.waterQuality ? { on: true } : {} };
      say(s, "Loading maps…");
      let maps;
      try { maps = await listMaps(opts.owner); }
      catch { if (s === shown) say(s, "Couldn't load the maps just now.", tryAgain(s)); return; }
      if (s !== shown) return;
      if (!maps.length) { say(s, NONE, el("p", { class: "maps-hint" }, NONE_HINT)); return; }   // UI1: and what happens next
      s.several = maps.length > 1;
      s.chosen = opts.item ? maps.find((m) => m.id === opts.item) : maps.length === 1 ? maps[0] : null;
      if (opts.item && !s.chosen) { say(s, UNAVAILABLE, el("a", { href: opts.href(null) }, "All maps")); return; }
      if (!s.chosen) { list(s, maps); return; }
      await draw(s);
    }

    function close() {
      const s = shown;
      if (!s) return;
      shown = null;
      dropMap(s);
      s.host.replaceChildren();
    }
    return { open, close, wake, listMaps, debug: () => shown?.map || null };
  }
  // ---- PH2: a calm group map --------------------------------------------------------------------------------------------------
  // An area as a person reads it: whole hectares, and a large group's to the nearest 10 or 100 ("243,700 ha", not "243,674.3 ha").
  function areaWords(ha) {
    const n = Number(ha);
    if (!Number.isFinite(n) || n <= 0) return "";
    const r = n >= 10000 ? Math.round(n / 100) * 100 : n >= 1000 ? Math.round(n / 10) * 10 : n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
    return r.toLocaleString("en-NZ") + " ha";
  }
  // The line under a group's map title. The viewer says "Surveyed <date>, <area>" from the package's survey_date, which the plugin
  // guesses from the commonest date among the features' date fields (drone photos, on a farm): a group's map is not surveyed. What
  // is true is when this version was published (map_packages.published_at, the date the maps list already gives as "Updated").
  const meta = ({ publishedAt = null, areaHa = null } = {}) => [publishedAt ? "Updated " + day(publishedAt) : "", areaWords(areaHa)].filter(Boolean).join(" · ");
  // The layer on a group's map that is its sub-groups: a categorised area layer drawn by the web map whose title says so, or whose
  // categories are mostly the group's own sub-groups' names (`names`, lower case).
  function subgroupLayer(L, names = []) {
    if (!L?.vector || L.geometry !== "polygon" || L.classes?.kind !== "categories") return false;
    if (/\b(sub-?groups?|catchment groups?)\b/i.test(String(L.title || ""))) return true;
    const labels = (L.legend || []).map((g) => String(g?.label || "").trim().toLowerCase()).filter(Boolean);
    return labels.length >= 2 && labels.filter((x) => names.includes(x)).length * 2 >= labels.length;
  }
  // The owner (13 Nov 2026): sub-groups in a neutral, soft, easy-to-tell-apart set, thin outlines, gentle translucent fills, never
  // brand colours. The same seven soft hues the Places map and a group's overview give groups (map-palette.js), one per sub-group in
  // turn, each with map-palette's outline for the background it opens on; its legend swatches drawn to match (an SVG, which the app's
  // content policy allows as a data: image). Every other layer, and every farm's map, is drawn as published.
  function calmLayer(L, palette, { onDark = false, hues = null } = {}) {
    const set = hues || palette.DEFAULT_HUES;
    const keys = [...new Set(L.vector.layers.flatMap((v) => Object.keys(v.by || {})))];
    const lookOf = (k) => palette.look(set[(k === "*" ? 0 : Number(k) || 0) % set.length], { onDark });
    const by = (f) => Object.fromEntries(keys.map((k) => [k, f(lookOf(k), k)]));
    const swatch = (lk) => "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect x="1.5" y="1.5" width="17" height="17" rx="2" fill="' +
      lk.fill + '" fill-opacity="0.35" stroke="' + lk.line + '" stroke-width="1.5"/></svg>');
    return { ...L, calm: true,
      vector: { ...L.vector, layers: [{ type: "fill", by: by((lk) => ({ color: lk.fill, opacity: 0.16 })) }, { type: "line", by: by((lk) => ({ color: lk.line, opacity: 1, width: 1.2 })) }] },
      legend: (L.legend || []).map((g, i) => ({ ...g, icon: swatch(lookOf(keys.includes(String(i)) ? String(i) : keys[0] || "0")) })) };
  }
  function calmManifest(manifest, { group = false, palette = null, names = [], onDark = false, hues = null } = {}) {
    if (!group || !palette || !Array.isArray(manifest?.layers)) return manifest;
    let changed = false;
    const layers = manifest.layers.map((L) => (subgroupLayer(L, names) ? ((changed = true), calmLayer(L, palette, { onDark, hues })) : L));
    return changed ? { ...manifest, layers } : manifest;
  }
  // The background and reference layers a group's map opens with on a phone: the plain map, roads and waterways off, unless the person
  // has chosen otherwise on this device (the viewer remembers their own choices; these are set only for the start and taken away)
  const PHONE_START = { "rv-basemap": "map", "rv-ref-ww": "0", "rv-ref-rd": "0" };

  // CTX2: where the viewer remembers a context layer's switch on this device (its contextDefs: "rv-ctx-" and the key as it cleans it)
  const ctxStore = (key) => { const k = String(key || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 80); return k ? "rv-ctx-" + k : null; };
  // CTX2: the viewer's reference layers for an owner: a group's map marks the layers that start on (startOn); a farm's map starts
  // every context layer off, as before. The internal startsOn mark is never passed on.
  function startOn(layers, owner) {
    const group = !!(owner && owner.org && !owner.farm);
    return (layers || []).map((r) => { const { startsOn, ...rest } = r; return startsOn && group ? { ...rest, startOn: true } : rest; });
  }
  // CTX2: run `start` (the viewer's mount) with each startOn layer's switch set on in `store` (localStorage) where the person has no
  // choice of their own remembered, then take away only what was set here. A store that cannot be used changes nothing.
  // PH2: on a phone a group's map is calm: `phoneGroup` seeds PHONE_START the same way and seeds no context layer on (the owner: "you
  // might use a map on your phone to find a site, but not turn on half a dozen layers"); each stays one tap away in Layers.
  function seedStartOn(store, layers, start, { phoneGroup = false } = {}) {
    const seeded = [];
    const seed = (k, v) => { try { if (k && store && store.getItem(k) === null) { store.setItem(k, v); seeded.push([k, v]); } } catch {} };
    if (phoneGroup) for (const [k, v] of Object.entries(PHONE_START)) seed(k, v);
    else for (const r of layers || []) if (r && r.startOn === true && r.style) seed(ctxStore(r.key), "1");
    try { return start(); }
    finally { for (const [k, v] of seeded) try { if (store.getItem(k) === v) store.removeItem(k); } catch {} }
  }
  return { create, backgrounds, filesByPath, ctxStore, startOn, seedStartOn, areaWords, meta, subgroupLayer, calmLayer, calmManifest, PHONE_START,
    BUCKET, MAX_MAPS, MAX_REFERENCE, LINK_SECONDS, RENEW_MS, NONE, UNAVAILABLE, RAN_OUT };
});
