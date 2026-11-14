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
    calm: async (manifest, owner, url) => {
      const group = !!(owner?.org && !owner.farm), css = typeof getComputedStyle === "function" ? getComputedStyle(document.documentElement) : null;
      let bm = null; try { bm = localStorage.getItem(BASEMAP_KEY); } catch {}
      // the group's sub-groups ({ id, name }): as Home reads them (subgroup_counts, for any member), else the person's own
      const mine = (FP.groupSpace?.groups?.() || []).filter((g) => g.parent_org_id === owner?.org).map((g) => ({ id: g.id, name: g.name }));
      let subs = mine;
      if (group && FP.sb?.rpc) {
        try { const { data, error } = await FP.sb.rpc("subgroup_counts", { parent_org: owner.org }); if (!error && Array.isArray(data) && data.length) subs = data.map((r) => ({ id: r.subgroup_id, name: r.subgroup_name })).filter((s) => s.id && s.name).slice(0, 40); } catch { /* the person's own */ }
      }
      const names = subs.map((s) => String(s.name || "").trim().toLowerCase());
      // PH5: the sub-groups' colours from the layer's own shapes (its file, read once here; the viewer's read of it is then the browser's
      // copy), each category matched to its sub-group first (review of #540, 2)
      const L = group && Array.isArray(manifest?.layers) ? manifest.layers.find((x) => api.subgroupLayer(x, names, subs)) : null;
      let colours = null;
      if (L && url && L.features) { try { const r = await fetch(url(L.features)); if (r.ok) colours = api.subgroupColoursOf(L, await r.json(), FP.mapPalette, subs); } catch { /* without the shapes */ } }
      if (L && !colours) colours = api.subgroupColoursOf(L, null, FP.mapPalette, subs);
      return api.calmManifest(manifest, { group, palette: FP.mapPalette, names, subs, onDark: (bm || "aerial") === "aerial", colours,
        hues: FP.mapPalette && css ? FP.mapPalette.hues((k) => css.getPropertyValue(k)) : null });
    },
    // PH5: a map about one place. A group's (or sub-group's) map: the viewer's white-and-black dashed boundary is hidden (the owner: no
    // dotted lines at overview scale) and everything outside the area is under the 35% mask, cut along the area's outer edge; a farm's
    // map keeps its boundary and gets the mask only when its own package has none. On a phone a published map's own text labels start
    // off (one tap away, Labels in Layers). viewer.js is not edited: its layers are switched from here once it has added them.
    focus: (map, holder, { group = false, manifest = null, url = null } = {}) => api.focusMap(map, holder, { group, manifest, url, phone: phone(), palette: FP.mapPalette, phoneModel: FP.phoneModel }),
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
        map: { label: "Topo", tiles: tiles("topo-raster", "webp"), attribution: ATTRIBUTION, maxzoom: 18 } },
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
      // (a legend swatch drawn here is an SVG data: image, passed as it is; every other file is a signed link)
      const url = (rel) => (typeof rel === "string" && rel.startsWith("data:image/svg+xml,") ? rel : read.urls[rel] || "");
      const group = !!(s.opts.owner?.org && !s.opts.owner.farm);
      let manifest = read.manifest;
      try { if (env.calm) manifest = await env.calm(read.manifest, s.opts.owner, url); } catch { manifest = read.manifest; }
      if (s !== shown) return;
      try {
        s.host.replaceChildren(holder);
        s.map = env.mount(holder, {
          manifest: { ...manifest, property: s.opts.name, title: s.chosen.title, map_title: s.chosen.title, description: s.chosen.description || "", kind: s.chosen.kind || "" },
          url,
          ...(group && env.phone?.() ? { phoneGroup: true } : {}),
          ...(read.shared.length ? { shared: read.shared } : {}),
          referenceLayers: startOn(read.referenceLayers, s.opts.owner),
          onBack: s.several ? () => env.go(s.opts.href(null)) : null, backLabel: "All maps",
          ...env.backgrounds(),
        });
        if (at) s.map.jumpTo(at);
        try { env.chrome?.(s.map, holder, { group, publishedAt: s.chosen.published_at, areaHa: read.manifest?.area_ha }); } catch {}
        try { env.focus?.(s.map, holder, { group, manifest: read.manifest, url }); } catch {}
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
  // (subs: the group's sub-groups, { id, name }: a category matched to one counts, review of #540, 2)
  function subgroupLayer(L, names = [], subs = null) {
    if (!L?.vector || L.geometry !== "polygon" || L.classes?.kind !== "categories") return false;
    if (/\b(sub-?groups?|catchment groups?)\b/i.test(String(L.title || ""))) return true;
    const labels = (L.legend || []).map((g) => String(g?.label || "").trim()).filter(Boolean);
    const matched = subs?.length ? matchSubgroups(labels, subs) : null;
    return labels.length >= 2 && labels.filter((x) => names.includes(x.toLowerCase()) || matched?.get(x)).length * 2 >= labels.length;
  }
  // The owner (13 Nov 2026): sub-groups in a neutral, soft, easy-to-tell-apart set, thin outlines, gentle translucent fills, never
  // brand colours. The same seven soft hues the Places map and a group's overview give groups (map-palette.js), one per sub-group in
  // turn, each with map-palette's outline for the background it opens on; its legend swatches drawn to match (an SVG, which the app's
  // content policy allows as a data: image). Every other layer, and every farm's map, is drawn as published.
  // PH5 (the owner, 14 Nov 2026: "make the group colours more bold and therefore reduce need for clear outside line"): each sub-group
  // a clear fill from the set that tells neighbours apart (map-palette.js subgroupColours, by its name: `colours`, name -> hue, the
  // same colours Home gives them), at an opacity that reads on the aerial, with a hairline of the same hue and no dashes.
  function calmLayer(L, palette, { onDark = true, hues = null, colours = null } = {}) {
    const set = palette.SUBGROUP_HUES || hues || palette.DEFAULT_HUES;
    const keys = [...new Set(L.vector.layers.flatMap((v) => Object.keys(v.by || {})))];
    // a class's name: its legend label, by its place in the legend (the plugin numbers the categories in legend order)
    const nameOf = (k) => String(L.legend?.[k === "*" ? 0 : Number(k) || 0]?.label || "").trim();
    const hueOf = (k) => (colours && colours.get?.(nameOf(k))) || set[(k === "*" ? 0 : Number(k) || 0) % set.length];
    const lookOf = (k) => (palette.subgroupLook ? palette.subgroupLook(hueOf(k), { onDark }) : { ...palette.look(hueOf(k), { onDark }), fillOpacity: 0.5, lineWidth: 0.75, lineOpacity: 0.9 });
    const by = (f) => Object.fromEntries(keys.map((k) => [k, f(lookOf(k), k)]));
    const swatch = (lk) => "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect x="1.5" y="1.5" width="17" height="17" rx="2" fill="' +
      lk.fill + '" fill-opacity="' + lk.fillOpacity + '" stroke="' + lk.line + '" stroke-width="1"/></svg>');
    return { ...L, calm: true,
      vector: { ...L.vector, layers: [{ type: "fill", by: by((lk) => ({ color: lk.fill, opacity: lk.fillOpacity })) }, { type: "line", by: by((lk) => ({ color: lk.line, opacity: lk.lineOpacity ?? 0.9, width: lk.lineWidth })) }] },
      legend: (L.legend || []).map((g, i) => ({ ...g, icon: swatch(lookOf(keys.includes(String(i)) ? String(i) : keys[0] || "0")) })) };
  }
  function calmManifest(manifest, { group = false, palette = null, names = [], subs = null, onDark = true, hues = null, colours = null } = {}) {
    if (!group || !palette || !Array.isArray(manifest?.layers)) return manifest;
    let changed = false;
    const layers = manifest.layers.map((L) => (subgroupLayer(L, names, subs) ? ((changed = true), calmLayer(L, palette, { onDark, hues, colours })) : L));
    return changed ? { ...manifest, layers } : manifest;
  }
  // PH5: what the app does to the viewer's map once it is up (env.focus): the viewer's own layers are only switched or added to, never
  // changed in viewer.js. `when` waits for the viewer to have added its layers (it does so as its style loads).
  const BASE_LAYER = /^(bg|bm-.*|hillshade)$/, WAIT_MS = 20000;
  function focusMap(map, holder, { group = false, manifest = null, url = null, phone = false, palette = null, phoneModel = null } = {}) {
    if (!map) return;
    // (review of #540, 10: it stops listening once the layer is there, or after WAIT_MS if it never comes)
    const when = (test, then) => {
      try { if (test()) { then(); return; } } catch { return; }
      let timer = null;
      const off = () => { clearTimeout(timer); map.off("styledata", h); map.off("idle", h); };
      const h = () => { let ok = false; try { ok = !!test(); } catch { off(); return; } if (!ok) return; off(); then(); };
      map.on("styledata", h); map.on("idle", h);
      timer = setTimeout(off, WAIT_MS);
      timer?.unref?.();   // (in Node's tests, the wait never holds the process open)
    };
    // a group's map: no dashed boundary round the area (the mask shows where it ends)
    if (group) when(() => map.getLayer("boundary"), () => { for (const id of ["boundary", "boundary-halo"]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none"); });
    // the mask: outside the area's outer edge, under everything the map draws over its background. Review of #540, 4: exactly one
    // mask: a package that shades the outside itself (its "Shade outside", the viewer's own mask) keeps its own, and this is not added
    if (!manifest?.mask && manifest?.boundary && url && palette?.outsideMask && phoneModel?.outlineFor && typeof fetch === "function") {
      fetch(url(manifest.boundary)).then((r) => (r.ok ? r.json() : null)).then((fc) => {
        const polys = (fc?.features || (fc?.geometry ? [fc] : [])).flatMap((f) => { const g = f.geometry || f; return g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? g.coordinates : []; });
        if (!polys.length) return;
        const mask = palette.outsideMask(phoneModel.outlineFor({ type: "MultiPolygon", coordinates: polys }, { key: "map-" + manifest.boundary }));
        if (!mask) return;
        when(() => map.getLayer("boundary-halo"), () => {
          if (map.getSource("ph-mask")) return;
          map.addSource("ph-mask", { type: "geojson", data: mask });
          const above = (map.getStyle().layers || []).find((l) => !BASE_LAYER.test(l.id));
          map.addLayer({ id: "ph-mask", type: "fill", source: "ph-mask", paint: { "fill-color": "#000000", "fill-opacity": palette.MASK_OPACITY ?? 0.35, "fill-antialias": false } }, above?.id);
        });
      }).catch(() => { /* the map stays as it is */ });
    }
    // a group's map on a phone: the published map's own text labels start off at the overview (the viewer's Labels switch, in Layers).
    // Review of #540, 3: a farm's own map keeps its labels as published.
    if (phone && group) {
      let tries = 0;
      const off = () => {
        const sw = holder?.querySelector?.("#rv-l-labels");
        if (!sw) { if (++tries < 40) setTimeout(off, 100); return; }
        if (sw.checked) { sw.checked = false; sw.dispatchEvent(new Event("change", { bubbles: true })); }
      };
      off();
    }
  }
  // PH5: the sub-groups' colours for a group's map, from its sub-groups layer's own shapes (so neighbours differ, and each sub-group
  // has the colour Home gives it): Map name -> hue, or null. features: the layer's FeatureCollection (each feature's class `_cls`).
  // Review of #540, 2: a published map names its sub-groups its own way ("Whitcombe Landcare Group", "Otuwharekai Ashburton Lakes")
  // where the platform has "Whitcombe" and "Ashburton Lakes". Each category is matched to the group's own sub-group before colouring:
  // the same name ignoring case; else the one sub-group all of whose words are in the category's name (or all the category's words in
  // the sub-group's), the one with the most words where several are; else, where both have shapes, the sub-group whose area's box
  // overlaps the category's the most (at least half of the smaller). Map label -> sub-group ({ id, name }), or null when none.
  const words = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
  const boxOf = (g) => { let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity; const walk = (c) => (typeof c?.[0] === "number" ? ([w, s, e, n] = [Math.min(w, c[0]), Math.min(s, c[1]), Math.max(e, c[0]), Math.max(n, c[1])]) : (c || []).forEach(walk)); walk(g?.coordinates); return Number.isFinite(w) ? [w, s, e, n] : null; };
  function matchSubgroups(labels, subs, { shapes = null } = {}) {
    const out = new Map(), list = (subs || []).filter((s) => s && s.name);
    for (const label of labels || []) {
      const lw = words(label), low = String(label).trim().toLowerCase();
      let hit = list.find((s) => String(s.name).trim().toLowerCase() === low) || null;
      if (!hit) {
        const within = list.filter((s) => { const sw = words(s.name); return sw.length && (sw.every((w) => lw.includes(w)) || lw.every((w) => sw.includes(w))); });
        const most = Math.max(0, ...within.map((s) => words(s.name).length));
        const best = within.filter((s) => words(s.name).length === most);
        if (best.length === 1) hit = best[0];
      }
      if (!hit && shapes?.label?.get(label)) {
        const a = boxOf(shapes.label.get(label)), size = (b) => (b[2] - b[0]) * (b[3] - b[1]);
        let top = 0;
        for (const s of list) {
          const b = shapes.sub?.get(s.id) ? boxOf(shapes.sub.get(s.id)) : null;
          if (!a || !b) continue;
          const ov = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
          const share = ov / Math.max(1e-12, Math.min(size(a), size(b)));
          if (share >= 0.5 && share > top) { top = share; hit = s; }
        }
      }
      out.set(label, hit);
    }
    return out;
  }
  // The colours for a group's map: Map category label -> hue. Each category is first matched to its sub-group (matchSubgroups), and
  // the group's every sub-group is coloured by its id, with the category's shapes where it has them: the same set and keys Home
  // colours, so a sub-group has the same colour on both. subs: the group's sub-groups ({ id, name }); with none, by the labels alone.
  function subgroupColoursOf(L, features, palette, subs = []) {
    if (!L || !palette?.subgroupColours) return null;
    const byLabel = new Map();
    for (const f of features?.features || []) {
      const label = String(L.legend?.[Number(f.properties?._cls) || 0]?.label || f.properties?.name || "").trim(), g = f.geometry;
      if (!label || !g) continue;
      const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
      byLabel.set(label, [...(byLabel.get(label) || []), ...polys]);
    }
    const labels = [...new Set([...(L.legend || []).map((g) => String(g?.label || "").trim()).filter(Boolean), ...byLabel.keys()])];
    const geom = (label) => (byLabel.get(label)?.length ? { type: "MultiPolygon", coordinates: byLabel.get(label) } : null);
    const match = matchSubgroups(labels, subs);
    const items = new Map();   // key -> { key, name, geometry }
    for (const s of subs || []) if (s?.id && s.name) items.set(String(s.id), { key: String(s.id), name: s.name, geometry: null });
    for (const label of labels) {
      const s = match.get(label), k = s ? String(s.id) : "label:" + label;
      const it = items.get(k) || { key: k, name: s ? s.name : label, geometry: null };
      const g = geom(label);
      if (g) it.geometry = it.geometry ? { type: "MultiPolygon", coordinates: [...it.geometry.coordinates, ...g.coordinates] } : g;
      items.set(k, it);
    }
    const byName = palette.subgroupColours([...items.values()]);
    return new Map(labels.map((label) => { const s = match.get(label); return [label, byName.get(s ? s.name : label)]; }));
  }
  // The background and reference layers a group's map opens with on a phone: the plain map, roads and waterways off, unless the person
  // has chosen otherwise on this device (the viewer remembers their own choices; these are set only for the start and taken away)
  // PH5: the background is the viewer's own default, the aerial (the owner: the plain map loads slow on a phone and looks busy); the
  // person's own choice in the viewer's Layers is still remembered by the viewer
  const PHONE_START = { "rv-ref-ww": "0", "rv-ref-rd": "0" };

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
  return { create, backgrounds, filesByPath, ctxStore, startOn, seedStartOn, areaWords, meta, subgroupLayer, calmLayer, calmManifest, subgroupColoursOf, matchSubgroups, focusMap, PHONE_START,
    BUCKET, MAX_MAPS, MAX_REFERENCE, LINK_SECONDS, RENEW_MS, NONE, UNAVAILABLE, RAN_OUT };
});
