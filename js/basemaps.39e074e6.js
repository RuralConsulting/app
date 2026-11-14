// Background maps: LINZ Basemaps (CC BY 4.0), the brief's basemap. Free and licensed for this use, with the
// attribution LINZ asks for. Only LINZ tile sets and style JSONs are used (no Esri or other providers).
//   aerial       raster imagery, in the style from the start (the default)
//   topographic  LINZ vector style, fetched and merged in as sources + layers when picked
//   topolite     the lighter LINZ vector style, merged the same way
//   elevation    terrain-rgb raster-dem (MapLibre encoding "mapbox") for 3D terrain and a client-side hillshade;
//                LINZ's pre-rendered hillshade-igor raster is shown instead where terrain is off
// Tile URLs, zooms and the hillshade opacity follow LINZ's own topographic-v2 / topolite-v2 styles (checked 30 Oct 2026).
// Everything is added under the farm layers (the farm's own layers are added later, on top), never a style swap.
// With no key (and always in demo mode) there are no sets and no requests: a plain background.
FP.basemaps = (() => {
  const key = FP.demo?.active ? null : FP_CONFIG.linzKey;
  const ROOT = "https://basemaps.linz.govt.nz/v1";
  const api = key ? "api=" + encodeURIComponent(key) : "";
  const tiles = (set, ext, extra = "") => [`${ROOT}/tiles/${set}/WebMercatorQuad/{z}/{x}/{y}.${ext}?${api}${extra}`];
  const ATTRIB = '<a href="https://www.linz.govt.nz/copyright" target="_blank" rel="noopener">LINZ CC BY 4.0</a> © ' +
    '<a href="https://basemaps.linz.govt.nz/" target="_blank" rel="noopener">Imagery Basemap contributors</a>';
  const VECTOR = { topographic: "Topographic", topolite: "Topolite" };
  // PH5 (the owner, 14 Nov 2026, after the background trial: "the LINZ aerial actually looks okay and the alternative is the topo"):
  // the backgrounds offered are the aerial and LINZ's Topo50 raster map ("topo-raster": the topo New Zealand farmers know; about
  // 2 s and 270 KB for a first view on a slow phone, against 12 to 14 s and 1.2 to 1.6 MB for the vector styles; tiles to zoom 18, the
  // map overzooms beyond). The vector styles are no longer offered; their code path stays (pick still merges one if asked).
  const OFFERED = { aerial: "Aerial", topo: "Topo" };
  const labels = { ...OFFERED, ...VECTOR };
  // LINZ publishes the vector styles under versioned names (basemaps.linz.govt.nz/docs, vector tiles usage)
  const STYLE = { topographic: "topographic-v2", topolite: "topolite-v2" };
  const names = key ? Object.keys(OFFERED) : [];
  const known = key ? Object.keys(labels) : [];
  const RASTER = ["aerial", "topo"];
  const EXAGGERATION = 1.3;

  // 3D terrain is on by default only where the device copes: not on low-memory or few-core phones, not
  // when the person has asked their device to save data.
  function terrainDefault(nav = typeof navigator === "undefined" ? {} : navigator) {
    if (!key) return false;
    if (nav.connection?.saveData) return false;
    if (nav.deviceMemory && nav.deviceMemory < 4) return false;
    if (nav.hardwareConcurrency && nav.hardwareConcurrency < 4) return false;
    return true;
  }

  // PH5: an overview map (a group's Home on a phone, a group's overview, the Water quality page) draws no relief over the aerial: the
  // photograph has its own, and LINZ's hillshade tiles were a second set of requests under every aerial tile (at zoom 9 a hillshade
  // tile is larger than the aerial's). It still comes with the plain map. A farm's own detailed map keeps it, as before.
  // opts.reliefOnAerial: false for those maps (kept in the style's metadata, which pick reads).
  function style(initial = "aerial", { reliefOnAerial = true } = {}) {
    const s = { version: 8, sources: {}, layers: [{ id: "bm-blank", type: "background", paint: { "background-color": getComputedStyle(document.documentElement).getPropertyValue("--map-background").trim() } }] };
    if (!key) return s;
    s.metadata = { "fp:reliefOnAerial": reliefOnAerial };
    // LINZ's own font glyphs, for map labels drawn by MapLibre (river names, DM2); the vector styles use the same server
    s.glyphs = `${ROOT}/fonts/{fontstack}/{range}.pbf?${api}`;
    s.sources["bm-aerial"] = { type: "raster", tiles: tiles("aerial", "webp"), tileSize: 256, maxzoom: 22, attribution: ATTRIB };
    s.layers.push({ id: "bm-aerial", type: "raster", source: "bm-aerial", layout: { visibility: initial === "aerial" ? "visible" : "none" } });
    s.sources["bm-topo"] = { type: "raster", tiles: tiles("topo-raster", "webp"), tileSize: 256, maxzoom: 18, attribution: ATTRIB };
    s.layers.push({ id: "bm-topo", type: "raster", source: "bm-topo", layout: { visibility: initial === "topo" ? "visible" : "none" } });
    s.sources["bm-dem"] = { type: "raster-dem", tiles: tiles("elevation", "png", "&pipeline=terrain-rgb"), tileSize: 256, maxzoom: 18, encoding: "mapbox", attribution: ATTRIB };
    s.sources["bm-hillshade"] = { type: "raster", tiles: tiles("hillshade-igor", "webp", "&pipeline=color-ramp-opacity"), tileSize: 256, maxzoom: 18, attribution: ATTRIB };
    // pre-rendered hillshade where terrain is off; client-side hillshade where it is on (swapped by setTerrain)
    s.layers.push({ id: "bm-hillshade-raster", type: "raster", source: "bm-hillshade", layout: { visibility: reliefOnAerial || !RASTER.includes(initial) ? "visible" : "none" }, paint: { "raster-opacity": { stops: [[0, 0.25], [5, 0.25], [8, 0.3], [12, 0.4], [16, 0.5]] } } });
    s.layers.push({ id: "bm-hillshade", type: "hillshade", source: "bm-dem", layout: { visibility: "none" },
      paint: { "hillshade-exaggeration": 0.5, "hillshade-shadow-color": "#2b2b2b", "hillshade-highlight-color": "#ffffff", "hillshade-accent-color": "#555555" } });
    return s;
  }

  // Whether a map draws relief over the aerial: its own setting (reliefOnAerial below: Places switches it as it shows an overview or
  // a farm), else what its style was made with
  const reliefMode = new WeakMap();
  const reliefWanted = (map) => (reliefMode.has(map) ? reliefMode.get(map) : map.getStyle?.()?.metadata?.["fp:reliefOnAerial"] !== false);
  // the pre-rendered relief, shown unless terrain draws its own or this map draws none over the aerial showing now
  function showRelief(map) {
    if (!map.getLayer?.("bm-hillshade-raster") || map.getTerrain?.()) return;
    // (the aerial and the topo carry their own relief: an overview draws none over either)
    const raster = map.getLayoutProperty?.("bm-aerial", "visibility") !== "none" || (!!map.getLayer?.("bm-topo") && map.getLayoutProperty?.("bm-topo", "visibility") === "visible");
    map.setLayoutProperty("bm-hillshade-raster", "visibility", raster && !reliefWanted(map) ? "none" : "visible");
  }
  // review of #540, 8: the one map Places and a farm share draws relief over the aerial for a farm, not for Places
  function reliefOnAerial(map, on) { if (!map) return; reliefMode.set(map, !!on); showRelief(map); }
  function setTerrain(map, on) {
    if (!key || !map.getSource("bm-dem")) return false;
    if (on) map.setTerrain({ source: "bm-dem", exaggeration: EXAGGERATION }); else map.setTerrain(null);
    map.setLayoutProperty("bm-hillshade", "visibility", on ? "visible" : "none");
    if (on) map.setLayoutProperty("bm-hillshade-raster", "visibility", "none"); else if (map.getLayoutProperty) showRelief(map); else map.setLayoutProperty("bm-hillshade-raster", "visibility", "visible");
    return on;
  }

  // sources + layers of a LINZ style JSON, ids prefixed so they never meet the farm's, inserted under the hillshade
  function merge(map, name, json) {
    const own = { sources: [], layers: [] };
    for (const [id, src] of Object.entries(json.sources || {})) {
      map.addSource(`bm-${name}-${id}`, src); own.sources.push(`bm-${name}-${id}`);
    }
    for (const l of json.layers || []) {
      const spec = { ...l, id: `bm-${name}-${l.id}` };
      if (spec.source) spec.source = `bm-${name}-${spec.source}`;
      map.addLayer(spec, map.getLayer("bm-hillshade-raster") ? "bm-hillshade-raster" : undefined); own.layers.push(spec.id);
    }
    return own;
  }
  // UI2b: what each map has merged and its latest pick are its own (they were shared by every map on the page: a set merged into
  // one map was taken to be on another, and a pick on one map could cancel a pick on another)
  const perMap = new WeakMap();   // map -> { merged: name -> {sources, layers} (fetched once per map, kept hidden afterwards), token }
  const stateOf = (map) => { let s = perMap.get(map); if (!s) perMap.set(map, (s = { merged: new Map(), token: 0 })); return s; };
  // The plain ground alone (every background hidden), shown while a chosen background is fetched
  function ground(map) {
    if (map.getLayer?.("bm-aerial")) map.setLayoutProperty("bm-aerial", "visibility", "none");
    if (map.getLayer?.("bm-topo")) map.setLayoutProperty("bm-topo", "visibility", "none");
    for (const [, o] of stateOf(map).merged) for (const id of o.layers) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
  }
  // PH5: LINZ sends its style JSONs with "Cache-Control: no-store", so each map on each page fetched the same one again (47 KB, before
  // its sprites, fonts and tiles could start). Fetched once per page here, and shared by every map on it.
  const styleJson = new Map();   // name -> Promise of the style JSON
  function fetchStyle(which) {
    if (!styleJson.has(which)) {
      const p = fetch(`${ROOT}/styles/${STYLE[which]}.json?${api}`).then((res) => { if (!res.ok) throw new Error("basemap " + which + ": " + res.status); return res.json(); });
      styleJson.set(which, p);
      p.catch(() => styleJson.delete(which));   // (a failed fetch is tried again next time)
    }
    return styleJson.get(which);
  }
  async function pick(map, which) {
    if (!known.includes(which)) return;
    const st = stateOf(map), merged = st.merged;
    const mine = ++st.token;
    let own = merged.get(which);
    if (VECTOR[which] && !own) {
      const json = await fetchStyle(which);
      if (mine !== st.token) return;
      if (json.glyphs && map.setGlyphs) map.setGlyphs(json.glyphs);
      if (json.sprite && map.setSprite) map.setSprite(json.sprite);
      own = merge(map, which, json); merged.set(which, own);
    }
    if (mine !== st.token) return;
    map.setLayoutProperty("bm-aerial", "visibility", which === "aerial" ? "visible" : "none");
    if (map.getLayer?.("bm-topo")) map.setLayoutProperty("bm-topo", "visibility", which === "topo" ? "visible" : "none");
    // (no relief over the aerial or the topo on an overview map; with a vector map it comes back)
    if (!reliefWanted(map) && map.getLayer?.("bm-hillshade-raster") && !map.getTerrain?.()) map.setLayoutProperty("bm-hillshade-raster", "visibility", RASTER.includes(which) ? "none" : "visible");
    for (const [name, o] of merged) for (const id of o.layers) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", name === which ? "visible" : "none");
  }
  // PH2: on a narrow map MapLibre opens its compact credit expanded, a dark box across the bottom of the map (the owner's phone, under
  // the +). It starts folded to its small "i" instead, once, when it first has something to say; a tap on the "i" still opens it, as
  // the licences ask the credit to be within reach. A person's own tap is never undone.
  function quietCredit(map) {
    let done = false;
    const tick = () => {
      if (done) return;
      const a = map.getContainer?.().querySelector(".maplibregl-ctrl-attrib.maplibregl-compact");
      if (!a) return;
      done = true;
      a.classList.remove("maplibregl-compact-show"); a.removeAttribute("open");
      map.off("styledata", tick); map.off("sourcedata", tick);
    };
    map.on("styledata", tick); map.on("sourcedata", tick); setTimeout(tick, 0);
  }
  return { style, pick, ground, setTerrain, reliefOnAerial, terrainDefault, names, labels, missingKey: !key, exaggeration: EXAGGERATION, quietCredit };
})();
