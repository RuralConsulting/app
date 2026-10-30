// The farm map: one read (farm_map) draws the farm's extent, titles, layers and its own reference features.
// Reference features are only those on the farm or linked to its permits; radius analysis (wells within
// 2 km) is advisor-side job tooling and never drawn here (ARCHITECTURE.md "Presenting reference data").
FP.farmMap = (() => {
  let map = null;
  let opening = 0;
  let ready = null;    // resolves once the map's style has loaded
  let added = [];      // MapLibre layer and source ids for the current farm
  let markers = [];    // land unit labels
  const interactive = new Map();   // MapLibre layer id -> how to describe a hit

  const accent = () => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();

  function init() {
    if (map) return map;
    maplibregl.setWorkerUrl("vendor/maplibre-gl-csp-worker.js");
    map = new maplibregl.Map({
      container: "map", style: FP.basemaps.style("aerial"),
      bounds: [[166.3, -47.4], [178.6, -34.3]], maxZoom: 21,
      attributionControl: { compact: true, customAttribution: FP.brand.org_legal },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    // the style is a plain object, so it can finish loading before a "load" listener runs: also poll for it
    ready = new Promise((res) => {
      map.once("style.load", res); map.once("load", res);
      const poll = () => (map.style && map.style._loaded ? res() : setTimeout(poll, 50));
      poll();
    });
    // UI colours follow the same tokens as the shell, including a live OS/theme change.
    const syncPalette = () => ready.then(() => {
      if (map.getLayer("bm-blank")) map.setPaintProperty("bm-blank", "background-color",
        getComputedStyle(document.documentElement).getPropertyValue("--map-background").trim());
      for (const [id, property] of [["portfolio-fill", "fill-color"], ["portfolio-line", "line-color"],
        ["extent-line", "line-color"], ["action-programme-lines", "line-color"], ["action-programme-points", "circle-color"]]) {
        if (map.getLayer(id)) map.setPaintProperty(id, property, accent());
      }
    });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncPalette);
    new MutationObserver(syncPalette).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
    map.on("click", onClick);
    map.on("mousemove", (e) => {
      const ids = [...interactive.keys()].filter((id) => map.getLayer(id));
      map.getCanvas().style.cursor = ids.length && map.queryRenderedFeatures(e.point, { layers: ids }).length ? "pointer" : "";
    });
    return map;
  }

  const loaded = () => ready;

  function clear() {
    for (const m of markers) m.remove();
    markers = [];
    for (const { kind, id } of [...added].reverse()) {
      if (kind === "layer" && map.getLayer(id)) map.removeLayer(id);
      if (kind === "source" && map.getSource(id)) map.removeSource(id);
    }
    added = [];
    interactive.clear();
  }

  function source(id, data) {
    map.addSource(id, { type: "geojson", data });
    added.push({ kind: "source", id });
  }
  function layer(spec, describe) {
    map.addLayer(spec);
    added.push({ kind: "layer", id: spec.id });
    if (describe) interactive.set(spec.id, describe);
    return spec.id;
  }

  // the layers of one farm layer, by geometry: [polygonIds, lineIds, pointIds] filled in by pass
  function farmLayer(l, i, pass) {
    const sid = `fl-${i}`;
    const st = FP.qml.style(l);
    const describe = (f) => ({
      title: f.properties.name || f.properties.Name || f.properties.type || f.properties.label || l.name,
      layerName: l.name, qualifier: l.shown_as, props: f.properties,
    });
    const ids = [];
    if (pass === "polygon" && l.geometry_type === "polygon") {
      // land units are described by their place (code, name, area, how mapped), not the source file's fields
      ids.push(layer({ id: sid + "-fill", type: "fill", source: sid, paint: { "fill-color": st.fill, "fill-opacity": st.fillOpacity } },
        l.theme === "land_units" ? null : describe));
      ids.push(layer({ id: sid + "-line", type: "line", source: sid, paint: { "line-color": st.line, "line-width": st.lineWidth } }));
    }
    if (pass === "line" && l.geometry_type === "line") {
      const paint = { "line-color": st.line, "line-width": st.lineWidth };
      if (st.dash) paint["line-dasharray"] = st.dash;
      ids.push(layer({ id: sid + "-casing", type: "line", source: sid, paint: { "line-color": "#000", "line-opacity": 0.35, "line-width": st.lineWidth + 2 } }));
      ids.push(layer({ id: sid + "-line", type: "line", source: sid, paint }, describe));
    }
    if (pass === "point" && l.geometry_type === "point") {
      ids.push(layer({ id: sid + "-pt", type: "circle", source: sid, paint: {
        "circle-color": st.fill, "circle-radius": Math.min(st.radius, 9),
        "circle-stroke-color": l.theme === "photos" ? "#231f20" : st.line, "circle-stroke-width": 1.5 } }, describe));
    }
    return ids;
  }

  function landUnitLabels(units) {
    for (const f of units.features) {
      const at = f.properties.label_at;
      if (!at) continue;
      const el = FP.el("div", { class: "lu-label" }, FP.el("b", {}, f.properties.code), FP.el("span", {}, f.properties.name));
      markers.push(new maplibregl.Marker({ element: el }).setLngLat(at).addTo(map));
    }
  }

  // The NZ -> farm zoom: a smooth fly, or a jump when the person asks their device for reduced motion.
  let flightKey = null;
  const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function fit(bounds, padding) {
    map.fitBounds(bounds, { padding, duration: reduced() ? 0 : 2600, maxZoom: 17 });
  }
  function union(boxes) {
    return boxes.reduce((a, b) => [[Math.min(a[0][0], b[0][0]), Math.min(a[0][1], b[0][1])], [Math.max(a[1][0], b[1][0]), Math.max(a[1][1], b[1][1])]]);
  }
  // Where a farm will sit once its view opens: clear of the overview rail (desktop) or sheet (phone).
  function farmPadding() {
    const wide = window.innerWidth > 800, rail = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--rail-width")) || 370;
    return { top: 40, left: 40, bottom: wide ? 40 : 94, right: wide ? 40 + rail : 40 };
  }
  function zoomTo(geom) {
    if (!map || !geom?.coordinates) return;
    const b = bbox(geom); flightKey = JSON.stringify(b); fit(b, farmPadding());
  }
  // Every farm the person can see, fitted to their extents; each pin opens its farm.
  async function portfolio(items, onSelect) {
    const request = ++opening;
    init(); await loaded();
    if (request !== opening) return;
    clear(); flightKey = null;
    map.resize();
    const shown = items.filter((i) => i.extent?.coordinates);
    if (!shown.length) return;
    source("portfolio", { type: "FeatureCollection", features: shown.map((i) => ({ type: "Feature", geometry: i.extent, properties: { id: i.id } })) });
    layer({ id: "portfolio-fill", type: "fill", source: "portfolio", paint: { "fill-color": accent(), "fill-opacity": 0.3 } });
    layer({ id: "portfolio-line", type: "line", source: "portfolio", paint: { "line-color": accent(), "line-width": 3 } });
    const boxes = [];
    for (const i of shown) {
      const b = bbox(i.extent); boxes.push(b);
      const pin = FP.el("button", { type: "button", class: "pf-pin", onclick: () => onSelect(i.id) }, FP.el("i"), FP.el("span", {}, i.name));
      markers.push(new maplibregl.Marker({ element: pin, anchor: "top" }).setLngLat([(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2]).addTo(map));
    }
    const wide = window.innerWidth > 800;
    fit(union(boxes), wide ? { top: 90, left: 480, bottom: 90, right: 110 } : { top: 80, left: 85, bottom: Math.round(window.innerHeight * 0.5), right: 85 });
  }

  function bbox(geom) {
    let w = 180, s = 90, e = -180, n = -90;
    const walk = (c) => (typeof c[0] === "number" ? ([w, s, e, n] = [Math.min(w, c[0]), Math.min(s, c[1]), Math.max(e, c[0]), Math.max(n, c[1])]) : c.forEach(walk));
    walk(geom.coordinates);
    return [[w, s], [e, n]];
  }

  async function open(farmId, supplied = null) {
    const request = ++opening;
    init();
    const { data, error } = supplied ? { data: supplied, error: null } : await FP.sb.rpc("farm_map", { f: farmId });
    if (error) throw error;
    if (!data) return null;
    await loaded();
    if (request !== opening) return null;
    clear();
    const entries = [];   // what the layer list shows: {key, name, sub, ids, on, markers, job}

    if (data.extent) {
      source("extent", { type: "Feature", geometry: data.extent, properties: {} });
      entries.push({ key: "extent", name: "Farm extent", sub: `${FP.ha(data.extent_ha)} · titles, leased land and land units`, on: true,
        ids: [layer({ id: "extent-line", type: "line", source: "extent", paint: { "line-color": accent(), "line-width": 3 } })] });
    }
    source("titles", data.titles);
    const titleIds = [layer({ id: "titles-line", type: "line", source: "titles",
      paint: { "line-color": "#ffffff", "line-width": 1.5, "line-dasharray": [2, 1.5] } }),
      layer({ id: "titles-hit", type: "fill", source: "titles", paint: { "fill-color": "#fff", "fill-opacity": 0 } },
        (f) => ({ title: `Title ${f.properties.title_no}`, layerName: "Record of title", qualifier: f.properties.source ? `Source: ${f.properties.source}` : null,
                  props: { area_ha: f.properties.area_ha, estate: f.properties.estate } }))];
    const nTitles = data.titles.features.length;
    const titleHa = data.titles.features.reduce((a, f) => a + (Number(f.properties.area_ha) || 0), 0);
    entries.push({ key: "titles", name: "Titles", sub: `${nTitles} title${nTitles === 1 ? "" : "s"}, ${FP.ha(titleHa)}`, on: true, ids: titleIds });

    data.layers.forEach((l, i) => source(`fl-${i}`, l.features));
    source("land-units", data.land_units);
    const layerIds = data.layers.map(() => []);
    for (const pass of ["polygon", "line", "point"]) {
      data.layers.forEach((l, i) => layerIds[i].push(...farmLayer(l, i, pass)));
    }
    data.layers.forEach((l, i) => {
      const n = l.features.features.length;
      const e = { key: l.theme, name: l.name, sub: [`${n} feature${n === 1 ? "" : "s"}`, l.shown_as].filter(Boolean).join(" · "),
                  ids: layerIds[i], job: l.job || null };
      if (l.theme === "land_units") {
        landUnitLabels(data.land_units);
        e.markers = markers.slice();
        e.ids.push(layer({ id: "land-units-hit", type: "fill", source: "land-units", paint: { "fill-color": "#000", "fill-opacity": 0 } },
          (f) => ({ title: `${f.properties.code} ${f.properties.name || ""}`.trim(), layerName: "Land unit", qualifier: f.properties.shown_as,
                    props: { area_ha: f.properties.area_ha, mapped: f.properties.method } })));
      }
      if (l.theme === "actions") {
        e.markers = [];
        for (const f of l.features.features) if (f.geometry?.type === "Point" && f.properties.map_code) {
          const label = FP.el("div", { class: "action-label" }, f.properties.map_code);
          const marker = new maplibregl.Marker({ element: label }).setLngLat(f.geometry.coordinates).addTo(map);
          markers.push(marker); e.markers.push(marker);
        }
      }
      entries.push(e);
    });

    for (const [i, r] of data.reference.entries()) {
      const sid = `ref-${i}`;
      source(sid, r.features);
      const n = r.features.features.length;
      const id = layer({ id: sid + "-pt", type: "circle", source: sid, paint: {
        "circle-color": "#1e88e5", "circle-radius": 7, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } },
        (f) => ({ title: `${r.theme === "wells" ? "Bore" : r.name} ${f.properties.external_id}`, layerName: r.name,
                  qualifier: f.properties.on_farm ? "On the farm" : "Off the farm, linked to the farm's permit",
                  props: f.properties, permits: f.properties.authorisations || [], attribution: r.attribution }));
      entries.push({ key: "reference", name: r.theme === "wells" ? `Bores on the farm (${n})` : r.name, sub: r.name, ids: [id] });
    }

    // what's on when the farm opens comes from config.js (farmView.defaultOn); the rest is a tick away
    const defaultOn = new Set([...(FP_CONFIG.farmView?.defaultOn || []), ...(FP.demo?.active ? ["actions"] : [])]);
    for (const e of entries) setVisible(e, defaultOn.has(e.key));

    if (data.extent) {
      map.resize();
      const b = bbox(data.extent);
      if (flightKey === JSON.stringify(b)) flightKey = null;   // the portfolio already started this zoom
      else fit(b, 40);
    }
    return { farm: data.farm, extentHa: data.extent_ha, entries };
  }

  function addActions(actions, units = []) {
    const features = [], groups = new Map();
    for (const a of actions || []) {
      const geometries = a.geom ? [a.geom] : (a.places || []).map((p) => p.geom).filter(Boolean);
      for (const geometry of geometries) {
        if (!geometry.coordinates) continue;
        const b = bbox(geometry), at = geometry.type === "Point" ? geometry.coordinates :
          units.find((u) => (a.places || []).some((p) => p.id === u.id))?.label_at?.coordinates ||
          [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
        features.push({ type: "Feature", geometry, properties: { name: a.title, code: a.map_code, timeframe: a.timeframe_text || a.due_date, status: a.status } });
        const key = at.join(",");
        if (!groups.has(key)) groups.set(key, { at, codes: [] });
        if (a.map_code) groups.get(key).codes.push(a.map_code);
      }
    }
    if (!features.length) return null;
    source("action-programme", { type: "FeatureCollection", features });
    const describe = (f) => ({ title: (f.properties.code || "") + " " + f.properties.name, props: f.properties, layerName: "Actions" });
    const ids = [
      layer({ id: "action-programme-lines", source: "action-programme", type: "line", paint: { "line-color": accent(), "line-width": 3 }, filter: ["!=", ["geometry-type"], "Point"] }, describe),
      layer({ id: "action-programme-points", source: "action-programme", type: "circle", paint: { "circle-color": accent(), "circle-radius": 6, "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 }, filter: ["==", ["geometry-type"], "Point"] }, describe),
    ];
    const actionMarkers = [];
    for (const { at, codes } of groups.values()) {
      const label = FP.el("div", { class: "action-label" }, codes.slice(0, 3).join(", ") + (codes.length > 3 ? " +" + (codes.length - 3) : ""));
      const marker = new maplibregl.Marker({ element: label }).setLngLat(at).addTo(map);
      markers.push(marker); actionMarkers.push(marker);
    }
    return { key: "actions", name: "Actions", ids, on: true, markers: actionMarkers, sub: features.length + " mapped locations" };
  }

  function setVisible(entry, on) {
    entry.on = on;
    for (const id of entry.ids) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    for (const m of entry.markers || []) m.getElement().style.display = on ? "" : "none";
  }

  function onClick(e) {
    const ids = [...interactive.keys()].filter((id) => map.getLayer(id));
    const hits = map.queryRenderedFeatures(e.point, { layers: ids });
    if (!hits.length) return;
    // points over lines over areas; titles last
    const rank = (h) => (h.layer.type === "circle" ? 0 : h.layer.type === "line" ? 1 : h.layer.id === "titles-hit" ? 3 : 2);
    hits.sort((a, b) => rank(a) - rank(b));
    const f = hits[0];
    const props = {};
    for (const [k, v] of Object.entries(f.properties)) {
      try { props[k] = typeof v === "string" && /^[[{]/.test(v) ? JSON.parse(v) : v; } catch { props[k] = v; }
    }
    const hit = interactive.get(f.layer.id)({ ...f, properties: props });
    if (props.authorisations && !hit.permits) hit.permits = props.authorisations;
    const popup = new maplibregl.Popup({ maxWidth: Math.min(320, map.getContainer().clientWidth - 24) + "px" }).setLngLat(e.lngLat).setDOMContent(FP.popup.content(hit)).addTo(map);
    keepInside(popup);
  }

  // The auto anchor is fixed from the size at open; re-anchor once layout/fonts settle, then pan whatever still overflows.
  function keepInside(popup) {
    const fit = () => {
      if (!popup.isOpen()) return;
      popup.setLngLat(popup.getLngLat());
      const b = popup.getElement().getBoundingClientRect(), f = map.getContainer().getBoundingClientRect(), pad = 8;
      const d = (lo, hi, flo, fhi) => (lo < flo + pad ? lo - flo - pad : hi > fhi - pad ? hi - fhi + pad : 0);
      const dx = d(b.left, b.right, f.left, f.right), dy = d(b.top, b.bottom, f.top, f.bottom);
      if (dx || dy) map.panBy([dx, dy], { duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200 });
    };
    requestAnimationFrame(fit);
    document.fonts?.ready.then(fit);
  }

  // Wait for a painted, idle map before capturing a view (DOM readiness alone is too early for WebGL).
  const whenIdle = () => new Promise((resolve) => { if (!map) return resolve(); map.once("idle", resolve); map.triggerRepaint(); });
  return { open, portfolio, zoomTo, camera: () => map && { zoom: map.getZoom(), moving: map.isMoving() }, setVisible, whenIdle, basemap: (k) => FP.basemaps.pick(init(), k), frame: (geom) => { if (map && geom?.coordinates) map.fitBounds(bbox(geom), { padding: 55, duration: 400 }); }, addActions,
    resize: () => map && map.resize() };
})();

