// Background maps. LINZ Basemaps (aerial imagery and topo) when a LINZ key is set in config.js; otherwise
// Esri's imagery and topo maps, as the map portal uses.
FP.basemaps = (() => {
  const key = FP_CONFIG.linzKey;
  const linz = (set) => [`https://basemaps.linz.govt.nz/v1/tiles/${set}/WebMercatorQuad/{z}/{x}/{y}.webp?api=${encodeURIComponent(key)}`];
  const sets = key ? {
    aerial: { tiles: linz("aerial"), maxzoom: 22, attribution: "Imagery © LINZ CC BY 4.0, Toitū Te Whenua" },
    topo: { tiles: linz("topographic-v2"), maxzoom: 18, attribution: "© LINZ CC BY 4.0, Toitū Te Whenua" },
  } : {
    aerial: { tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
              maxzoom: 19, attribution: "Imagery © Esri" },
    topo: { tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"],
            maxzoom: 19, attribution: "Map © Esri" },
  };
  function style(initial) {
    const s = { version: 8, sources: {}, layers: [] };
    for (const [k, b] of Object.entries(sets)) {
      s.sources["bm-" + k] = { type: "raster", tiles: b.tiles, tileSize: 256, maxzoom: b.maxzoom, attribution: b.attribution };
      s.layers.push({ id: "bm-" + k, type: "raster", source: "bm-" + k,
                      layout: { visibility: k === initial ? "visible" : "none" } });
    }
    return s;
  }
  function pick(map, which) {
    for (const k of Object.keys(sets)) map.setLayoutProperty("bm-" + k, "visibility", k === which ? "visible" : "none");
  }
  return { style, pick, names: Object.keys(sets) };
})();
