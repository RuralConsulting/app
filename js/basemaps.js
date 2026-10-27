// Background maps: LINZ Basemaps aerial imagery (CC BY 4.0), the brief's basemap. Free and licensed for this
// use, with the attribution LINZ asks for. Only tile sets listed here are used (no Esri or other providers).
// LINZ's topographic map is vector-only (its own style); adding it as a second background is a later piece of
// work, so the background switch shows only when more than one set is listed.
FP.basemaps = (() => {
  const key = FP_CONFIG.linzKey;
  const linz = (set) => [`https://basemaps.linz.govt.nz/v1/tiles/${set}/WebMercatorQuad/{z}/{x}/{y}.webp?api=${encodeURIComponent(key)}`];
  const ATTRIB = '<a href="https://www.linz.govt.nz/copyright" target="_blank" rel="noopener">LINZ CC BY 4.0</a> © ' +
    '<a href="https://basemaps.linz.govt.nz/" target="_blank" rel="noopener">Imagery Basemap contributors</a>';
  const sets = key ? { aerial: { tiles: linz("aerial"), maxzoom: 22, attribution: ATTRIB } } : {};

  function style(initial) {
    const s = { version: 8, sources: {}, layers: [{ id: "bm-blank", type: "background", paint: { "background-color": "#dfe6e1" } }] };
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
  return { style, pick, names: Object.keys(sets), missingKey: !key };
})();
