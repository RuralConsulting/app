// V4: Maps, in the farm and group spaces. Published maps (V1's published_maps and map_packages, the private map-packages bucket)
// shown with the portal's viewer (js/viewer.js), as portal/portal.js does: read the current package, sign its file links, mount.
// Every read is the signed-in person's, under V1's policies: the owner's members only. A person who is not a member reads no
// map, so no file is signed and the viewer is never started. Only maps not archived and with a current package are listed.
// Signed links last an hour. They are renewed ten minutes before they run out, by drawing the map again where it was; a tab that
// slept past that renews when it is looked at again. If renewing fails, the map goes and the person is told plainly.
// Client suggestions are off in v1: the viewer is given no `suggest`. farm-space.js and group-space.js only say when to open and close.
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
    go: (hash) => { location.hash = hash; }, now: () => Date.now(), visible: () => document.visibilityState === "visible",
    setTimer: (f, ms) => setTimeout(f, ms), clearTimer: (t) => clearTimeout(t),
  });
  document.addEventListener("visibilitychange", () => FP.mapsView.wake());
})(typeof window === "undefined" ? globalThis : window, function () {
  const BUCKET = "map-packages";
  const MAX_MAPS = 100, SIGN_BATCH = 500;
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
      const byPath = filesByPath(pkg.manifest, pkg.storage_prefix), paths = [...byPath.keys()], urls = {};
      for (let i = 0; i < paths.length; i += SIGN_BATCH) {
        const { data, error: refused } = await sb.storage.from(BUCKET).createSignedUrls(paths.slice(i, i + SIGN_BATCH), LINK_SECONDS);
        if (refused) throw refused;
        for (const d of data || []) if (d.signedUrl) for (const rel of byPath.get(d.path) || []) urls[rel] = d.signedUrl;
      }
      return Object.keys(urls).length ? { manifest: pkg.manifest, urls } : null;
    }

    function dropMap(s) {
      env.clearTimer(s.timer); s.timer = null; s.renewAt = Infinity;
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
          onBack: s.several ? () => env.go(s.opts.href(null)) : null, backLabel: "All maps",
          ...env.backgrounds(),
        });
        if (at) s.map.jumpTo(at);
      } catch { say(s, UNAVAILABLE, tryAgain(s)); return; }
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
      const s = shown = { host, opts, map: null, timer: null, renewAt: Infinity, chosen: null, several: false };
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
  return { create, backgrounds, filesByPath, BUCKET, MAX_MAPS, LINK_SECONDS, RENEW_MS, NONE, UNAVAILABLE, RAN_OUT };
});
