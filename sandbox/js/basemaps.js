// Background maps: LINZ Basemaps (CC BY 4.0), the brief's basemap. Free and licensed for this use, with the
// attribution LINZ asks for. Only LINZ tile sets and style JSONs are used (no Esri or other providers).
//   aerial       raster imagery, in the style from the start (the default)
//   topographic  LINZ vector style, fetched and merged in as sources + layers when picked
//   topolite     the lighter LINZ vector style, merged the same way
//   elevation    terrain-rgb raster-dem for 3D terrain and a client-side hillshade; the pre-rendered
//                elevation.hillshade raster set is shown instead where terrain is off
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
  const labels = { aerial: "Aerial", ...VECTOR };
  // LINZ publishes the vector styles under versioned names (basemaps.linz.govt.nz/docs, vector tiles usage)
  const STYLE = { topographic: "topographic-v2", topolite: "topolite-v2" };
  const names = key ? Object.keys(labels) : [];
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

  function style(initial = "aerial") {
    const s = { version: 8, sources: {}, layers: [{ id: "bm-blank", type: "background", paint: { "background-color": getComputedStyle(document.documentElement).getPropertyValue("--map-background").trim() } }] };
    if (!key) return s;
    s.sources["bm-aerial"] = { type: "raster", tiles: tiles("aerial", "webp"), tileSize: 256, maxzoom: 22, attribution: ATTRIB };
    s.layers.push({ id: "bm-aerial", type: "raster", source: "bm-aerial", layout: { visibility: initial === "aerial" ? "visible" : "none" } });
    s.sources["bm-dem"] = { type: "raster-dem", tiles: tiles("elevation", "png", "&pipeline=terrain-rgb"), tileSize: 256, maxzoom: 18, encoding: "terrain-rgb", attribution: ATTRIB };
    s.sources["bm-hillshade"] = { type: "raster", tiles: tiles("elevation.hillshade", "png"), tileSize: 256, maxzoom: 18, attribution: ATTRIB };
    // pre-rendered hillshade where terrain is off; client-side hillshade where it is on (swapped by setTerrain)
    s.layers.push({ id: "bm-hillshade-raster", type: "raster", source: "bm-hillshade", layout: { visibility: "visible" }, paint: { "raster-opacity": 0.35 } });
    s.layers.push({ id: "bm-hillshade", type: "hillshade", source: "bm-dem", layout: { visibility: "none" },
      paint: { "hillshade-exaggeration": 0.5, "hillshade-shadow-color": "#2b2b2b", "hillshade-highlight-color": "#ffffff", "hillshade-accent-color": "#555555" } });
    return s;
  }

  function setTerrain(map, on) {
    if (!key || !map.getSource("bm-dem")) return false;
    if (on) map.setTerrain({ source: "bm-dem", exaggeration: EXAGGERATION }); else map.setTerrain(null);
    map.setLayoutProperty("bm-hillshade", "visibility", on ? "visible" : "none");
    map.setLayoutProperty("bm-hillshade-raster", "visibility", on ? "none" : "visible");
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
  const merged = new Map();   // name -> {sources, layers}: a set is fetched once and kept (hidden) afterwards
  let token = 0;
  async function pick(map, which) {
    if (!names.includes(which)) return;
    const mine = ++token;
    let own = merged.get(which);
    if (VECTOR[which] && !own) {
      const res = await fetch(`${ROOT}/styles/${STYLE[which]}.json?${api}`);
      if (!res.ok) throw new Error("basemap " + which + ": " + res.status);
      const json = await res.json();
      if (mine !== token) return;
      if (json.glyphs && map.setGlyphs) map.setGlyphs(json.glyphs);
      if (json.sprite && map.setSprite) map.setSprite(json.sprite);
      own = merge(map, which, json); merged.set(which, own);
    }
    if (mine !== token) return;
    map.setLayoutProperty("bm-aerial", "visibility", which === "aerial" ? "visible" : "none");
    for (const [name, o] of merged) for (const id of o.layers) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", name === which ? "visible" : "none");
  }
  return { style, pick, setTerrain, terrainDefault, names, labels, missingKey: !key, exaggeration: EXAGGERATION };
})();
