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
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; return; }
  root.FP = root.FP || {};
  const FP = root.FP, BASEMAP_KEY = "rv-basemap";
  const linzKey = () => (FP.demo?.active || typeof FP_CONFIG === "undefined" ? null : FP_CONFIG.linzKey);
  // The viewer reads the person's remembered background as it starts. With no LINZ key (the demo) nothing is to be fetched,
  // so it starts on None; what the person had remembered is put back at once.
  function mount(holder, options) {
    if (linzKey()) return root.RCLViewer.mount(holder, options);
    let was = null;
    try { was = localStorage.getItem(BASEMAP_KEY); localStorage.setItem(BASEMAP_KEY, "none"); } catch {}
    try { return root.RCLViewer.mount(holder, options); }
    finally { try { if (was === null) localStorage.removeItem(BASEMAP_KEY); else localStorage.setItem(BASEMAP_KEY, was); } catch {} }
  }
  FP.mapsView = api.create({
    sb: () => FP.sb, el: (...a) => FP.el(...a), mount, backgrounds: () => api.backgrounds(linzKey()),
    // The viewer's stylesheet sets page-wide rules and is on only while a map is shown (index.html loads it as media="not all").
    styles: (on) => { const link = document.querySelector("link[data-viewer-styles]"); if (link) link.media = on ? "all" : "not all"; },
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
        ...(r.group ? { group: r.group } : {}), ...(r.order !== undefined ? { order: r.order } : {}) }));
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
            ...(Number.isFinite(ref.order) ? { order: ref.order } : {}) };
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
        el("ul", {}, ...maps.map((m) => el("li", {}, el("a", { href: s.opts.href(m.id) }, el("b", {}, m.title),
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
      const holder = el("div", { class: "maps-viewer" });
      try {
        env.styles(true);
        s.host.replaceChildren(holder);
        s.map = env.mount(holder, {
          manifest: { ...read.manifest, property: s.opts.name, title: s.chosen.title, map_title: s.chosen.title, description: s.chosen.description || "", kind: s.chosen.kind || "" },
          url: (rel) => read.urls[rel] || "",
          ...(read.shared.length ? { shared: read.shared } : {}),
          referenceLayers: read.referenceLayers,
          onBack: s.several ? () => env.go(s.opts.href(null)) : null, backLabel: "All maps",
          ...env.backgrounds(),
        });
        if (at) s.map.jumpTo(at);
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
      const s = shown = { host, opts, map: null, timer: null, renewAt: Infinity, chosen: null, several: false, overlay: null, wq: {} };
      say(s, "Loading maps…");
      let maps;
      try { maps = await readMaps(opts.owner); }
      catch { if (s === shown) say(s, "Couldn't load the maps just now.", tryAgain(s)); return; }
      if (s !== shown) return;
      if (!maps.length) { say(s, NONE); return; }
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
    return { open, close, wake };
  }
  return { create, backgrounds, filesByPath, BUCKET, MAX_MAPS, MAX_REFERENCE, LINK_SECONDS, RENEW_MS, NONE, UNAVAILABLE, RAN_OUT };
});
