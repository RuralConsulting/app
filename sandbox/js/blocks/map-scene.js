// Map scene block: frames, draws and labels the scene it is handed, a farm_map payload (extent, titles, layers,
// land units, the farm's own reference features). Reference features are only those on the farm or linked to its
// permits; radius analysis (wells within 2 km) is advisor-side job tooling and never drawn here (ARCHITECTURE.md
// "Presenting reference data"). The block draws on a surface: its own map in the frame it is given, or a live one the
// host hands it as ctx.surface (the farm space keeps one map for the session, so the NZ -> farm zoom is unbroken).
(function (root, factory) {
  const blocks = typeof module === "object" && module.exports ? require("./registry.js") : root.FP.blocks;
  const api = factory(blocks);
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP.mapScene = api; root.FP.farmMap = api.engine("map"); }
})(typeof window === "undefined" ? globalThis : window, function (blocks) {
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const count = (fc) => (Array.isArray(fc?.features) ? fc.features.length : 0);
  // empty: no boundary to frame; sparse: the boundary and nothing drawn inside it; full: anything more.
  function state(scene) {
    if (!scene?.extent?.coordinates) return "empty";
    const drawn = count(scene.titles) + count(scene.land_units) + (scene.layers || []).reduce((n, l) => n + count(l.features), 0) +
      (scene.reference || []).reduce((n, r) => n + count(r.features), 0);
    return drawn ? "full" : "sparse";
  }
  function render(scene, o, ctx) {
    const h = ctx.level, name = scene?.farm?.name ? "Map of " + esc(scene.farm.name) : "Map";
    if (ctx.state === "empty") return '<section class="map-scene map-scene-empty"><h' + h + ' class="visually-hidden">' + name + "</h" + h +
      '><p class="map-scene-note">No boundary recorded yet.</p></section>';
    return '<section class="map-scene"><h' + h + ' class="visually-hidden">' + name + "</h" + h + ">" + (ctx.surface ? "" : '<div class="map-scene-canvas"></div>') + "</section>";
  }
  // Draws the scene: on the host's surface when there is one, else on a map made in this block's own frame.
  function mounted(host, scene, o, ctx) {
    if (ctx.surface) return ctx.surface.open(scene?.farm?.id ?? null, scene || emptyScene, { show: o.show });
    const canvas = host.querySelector(".map-scene-canvas");
    if (!canvas) return null;
    const surface = engine(canvas);
    ctx.onDestroy(() => surface.remove());
    return surface.open(scene.farm?.id ?? null, scene, { show: o.show }).then((view) => view && { ...view, surface });
  }
  const emptyScene = { extent: null, titles: { type: "FeatureCollection", features: [] }, land_units: { type: "FeatureCollection", features: [] }, layers: [], reference: [] };
  const block = blocks.define({
    id: "map-scene", title: "Map scene", empty: "No boundary recorded yet.",
    // show: what is drawn when the scene opens (extent, titles, a layer's theme, reference, actions); null keeps the farm's default.
    options: { show: { type: "list", default: null } },
    state, render, mounted,
  });

  // One live map surface: engine("map") for the farm space, engine(element) for a block in its own frame.
  // The browser-only parts (MapLibre, the DOM) are touched only once a surface is opened.
  function engine(container) {
  let map = null;
  let opening = 0;
  let ready = null;    // resolves once the map's style has loaded
  let added = [];      // MapLibre layer and source ids for the current farm
  let markers = [];    // land unit labels
  const interactive = new Map();   // MapLibre layer id -> how to describe a hit
  let declutter = null;            // the label-collision handler for what is drawn (portfolio pins, or a farm's land unit labels)
  let drawn = null;                // the farm payload on the map now, for focus()

  const accent = () => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();

  let scheme = null, observer = null, syncPalette = null;
  function init() {
    if (map) return map;
    maplibregl.setWorkerUrl("vendor/maplibre-gl-csp-worker.js");
    map = new maplibregl.Map({
      container, style: FP.basemaps.style("aerial"),
      bounds: [[166.3, -47.4], [178.6, -34.3]], maxZoom: 21,
      attributionControl: { compact: true, customAttribution: FP.brand.org_legal },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    // the style is a plain object, so it can finish loading before a "load" listener runs: also poll for it
    ready = new Promise((res) => {
      map.once("style.load", res); map.once("load", res);
      const poll = () => (!map || map.style?._loaded ? res() : setTimeout(poll, 50));   // a removed map resolves (its open then stops)
      poll();
    });
    // 3D terrain where the device copes (the layers drawer can switch it)
    ready.then(() => FP.basemaps.setTerrain(map, FP.basemaps.terrainDefault()));
    // UI colours follow the same tokens as the shell, including a live OS/theme change.
    syncPalette = () => ready.then(() => {
      if (!map) return;
      if (map.getLayer("bm-blank")) map.setPaintProperty("bm-blank", "background-color",
        getComputedStyle(document.documentElement).getPropertyValue("--map-background").trim());
      for (const [id, property] of [["portfolio-fill", "fill-color"], ["portfolio-line", "line-color"],
        ["extent-line", "line-color"], ["action-programme-lines", "line-color"], ["action-programme-points", "circle-color"],
        ["focus-fill", "fill-color"], ["focus-line", "line-color"], ["focus-point", "circle-color"]]) {
        if (map.getLayer(id)) map.setPaintProperty(id, property, accent());
      }
    });
    scheme = window.matchMedia("(prefers-color-scheme: dark)"); scheme.addEventListener("change", syncPalette);
    observer = new MutationObserver(syncPalette); observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
    for (const ev of ["dragstart", "zoomstart", "rotatestart", "pitchstart"]) map.on(ev, (e) => { if (e.originalEvent) { settling++; touched = true; } });   // the person has taken the camera
    window.addEventListener("resize", onResize);
    map.on("click", onClick);
    map.on("mousemove", (e) => {
      const ids = [...interactive.keys()].filter((id) => map.getLayer(id));
      map.getCanvas().style.cursor = ids.length && map.queryRenderedFeatures(e.point, { layers: ids }).length ? "pointer" : "";
    });
    return map;
  }

  const loaded = () => ready;

  function clear() {
    if (declutter) { for (const ev of ["move", "resize"]) map.off(ev, declutter); declutter = null; }
    for (const m of markers) m.remove();
    markers = [];
    for (const { kind, id } of [...added].reverse()) {
      if (kind === "layer" && map.getLayer(id)) map.removeLayer(id);
      if (kind === "source" && map.getSource(id)) map.removeSource(id);
    }
    added = [];
    interactive.clear();
    drawn = null;
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
      layerName: l.name, qualifier: FP.farmModel.sourceLine(l), props: f.properties,
    });
    const ids = [];
    if (pass === "polygon" && l.geometry_type === "polygon") {
      // land units are described by their place (code, name, area) and one plain source line, not the source file's fields
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

  // Land unit labels: a code (LU1) and a name. When two would touch, the name goes and the code stays, the largest
  // unit keeping its name first; zoom in and the names come back (FP.farmModel.unitNames decides, from screen boxes).
  // At national scale the farm is a speck and its labels would pile into one glyph: they wait until it is in frame.
  function landUnitLabels(units, extent) {
    const labels = [];
    for (const f of units.features) {
      const at = f.properties.label_at;
      if (!at) continue;
      const el = FP.el("div", { class: "lu-label" }, FP.el("b", {}, f.properties.code), FP.el("span", {}, f.properties.name));
      markers.push(new maplibregl.Marker({ element: el }).setLngLat(at).addTo(map));
      labels.push({ el, area: Number(f.properties.area_ha) || 0 });
    }
    let queued = false;
    const place = () => {
      queued = false;
      const b = extent && project(extent), far = !!extent && (!b || Math.max(b.right - b.left, b.bottom - b.top) < 120);
      for (const l of labels) l.el.classList.toggle("far", far);
      if (far) return;
      const shown = labels.filter((l) => l.el.style.display !== "none");   // a layer switched off takes its labels with it
      for (const l of shown) l.el.classList.remove("code-only");
      const box = (n) => { const r = n.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
      const keep = FP.farmModel.unitNames(shown.map((l) => ({ area: l.area, full: box(l.el), code: box(l.el.querySelector("b")) })));
      shown.forEach((l, n) => l.el.classList.toggle("code-only", !keep[n]));
    };
    declutter = () => { if (!queued) { queued = true; requestAnimationFrame(place); } };
    for (const ev of ["move", "resize"]) map.on(ev, declutter);
    document.fonts?.ready.then(declutter);
    declutter();
  }

  // The NZ -> farm zoom: a smooth fly, or a jump when the person asks their device for reduced motion.
  let flightKey = null, settling = 0, framed = null, touched = false, resizing = 0, framedWidth = 0;   // framed: the extent last fitted; touched: the person has moved the map since
  const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wide = () => window.innerWidth > 800;
  function fit(bounds, padding, geom, duration = reduced() ? 0 : 2600) {
    map.fitBounds(bounds, { padding, duration, maxZoom: 17 });
    if (geom) { framed = geom; touched = false; framedWidth = window.innerWidth; settle(geom); }
  }
  // The window (or the pane the app sits in) changed size: frame the farm again for the new map, unless the person has moved it.
  // (A phone keeps its frame when only its height changes: that is the keyboard coming up.)
  function onResize() {
    const mine = ++resizing, width = window.innerWidth;
    setTimeout(() => {
      if (mine !== resizing || !map || !framed || touched || (!wide() && width === framedWidth)) return;
      framedWidth = width;
      map.resize();
      fit(bbox(framed), FP.farmModel.framePadding(inset(), wide()), framed, reduced() ? 0 : 300);
    }, 200);
  }
  // Once the camera has come to rest, any part of the farm still outside the visible map (clear of its controls
  // and, on a phone, the sheet) is brought back in. Not when the person has moved the map themselves.
  function settle(geom) {
    const mine = ++settling;
    map.once("idle", () => {
      if (mine !== settling || !map) return;
      const c = map.getContainer(), fix = FP.farmModel.frameFix(project(geom), { width: c.clientWidth, height: c.clientHeight }, FP.farmModel.framePadding(inset(), wide()));
      if (fix) map.easeTo({ zoom: map.getZoom() + fix.zoom, center: map.unproject(fix.at), duration: reduced() ? 0 : 400 });
    });
  }
  function union(boxes) {
    return boxes.reduce((a, b) => [[Math.min(a[0][0], b[0][0]), Math.min(a[0][1], b[0][1])], [Math.max(a[1][0], b[1][0]), Math.max(a[1][1], b[1][1])]]);
  }
  // Where a farm will sit once its view opens: clear of the overview rail (desktop) or sheet (phone).
  // Wide: the farm will be framed on a canvas that leaves room for the header and the panel, so this flight, which starts
  // on the portfolio's whole-window canvas, pads for the difference (the canvas already ends where the panel begins).
  function farmPadding() {
    if (!wide()) return { top: 40, left: 40, bottom: 94, right: 40 };
    const css = (name) => parseInt(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0, c = map.getContainer();
    const from = { width: c.clientWidth, height: c.clientHeight }, to = { width: from.width - (css("--rail-width") || 370), height: from.height - (css("--farm-header-height") || 106) };
    return FP.farmModel.flightPadding(FP.farmModel.framePadding(0, true), from, to);
  }
  // How far an open bottom sheet (phone) covers the map canvas: farm-space measures it into --sheet-overlap.
  const inset = () => parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sheet-overlap")) || 0;
  // Frame a farm extent in the part of the map the sheet leaves visible (or the whole map when no sheet covers it).
  function reframe(geom) {
    if (!map || !geom?.coordinates) return;
    flightKey = null;
    fit(bbox(geom), FP.farmModel.framePadding(inset(), wide()), geom, reduced() ? 0 : 500);
  }
  // An answer's place (a due line's land units, or a theme the map draws): marked on the map and framed with the
  // same fit and settle as the farm. Nothing on this map for it: nothing moves and nothing is marked (false).
  // null: the mark goes and the farm is framed again.
  function focus(place) {
    if (!map || !drawn?.extent) return false;
    const hits = place ? FP.farmModel.placeFeatures(drawn, place) : [];
    if (place && !hits.length) return false;
    map.getSource("focus")?.setData({ type: "FeatureCollection", features: hits });
    if (!place) { reframe(drawn.extent); return true; }
    let [[w, s], [e, n]] = union(hits.map((f) => bbox(f.geometry)));
    const min = 0.002;   // a single bore is framed with its surroundings (about 200 m)
    if (e - w < min) [w, e] = [(w + e) / 2 - min / 2, (w + e) / 2 + min / 2];
    if (n - s < min) [s, n] = [(s + n) / 2 - min / 2, (s + n) / 2 + min / 2];
    flightKey = null;
    fit([[w, s], [e, n]], FP.farmModel.framePadding(inset(), wide()), { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }, reduced() ? 0 : 900);
    return true;
  }
  // Where an extent sits on the map canvas, in px from its top-left corner (for checks that it is in view).
  function project(geom) {
    if (!map || !geom?.coordinates) return null;
    const [[w, s], [e, n]] = bbox(geom), a = map.project([w, n]), b = map.project([e, s]);
    return { left: a.x, top: a.y, right: b.x, bottom: b.y };
  }
  function zoomTo(geom) {
    if (!map || !geom?.coordinates) return;
    const b = bbox(geom); flightKey = JSON.stringify(b); fit(b, farmPadding(), geom);
  }
  // Every farm the person can see, fitted to their extents; each pin opens its farm.
  async function portfolio(items, onSelect) {
    const request = ++opening;
    init(); await loaded();
    if (request !== opening) return;
    clear(); flightKey = null; framed = null;
    map.resize();
    const shown = items.filter((i) => i.extent?.coordinates);
    if (!shown.length) return;
    source("portfolio", { type: "FeatureCollection", features: shown.map((i) => ({ type: "Feature", geometry: i.extent, properties: { id: i.id } })) });
    layer({ id: "portfolio-fill", type: "fill", source: "portfolio", paint: { "fill-color": accent(), "fill-opacity": 0.3 } });
    layer({ id: "portfolio-line", type: "line", source: "portfolio", paint: { "line-color": accent(), "line-width": 3 } });
    const boxes = [], pins = [];
    // larger farms keep their names when two names would touch; the list beside the map always has every name
    for (const i of [...shown].sort((a, b) => area(bbox(b.extent)) - area(bbox(a.extent)) || a.name.localeCompare(b.name))) {
      const b = bbox(i.extent); boxes.push(b);
      const pin = FP.el("button", { type: "button", class: "pf-pin", title: i.name, "aria-label": i.name, onclick: () => onSelect(i.id) }, FP.el("i"), FP.el("span", {}, i.name));
      pins.push(pin);
      markers.push(new maplibregl.Marker({ element: pin, anchor: "top" }).setLngLat([(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2]).addTo(map));
    }
    // Farm names never overlap: after every move, show each name unless it would touch a name already shown (or another pin).
    let queued = false;
    const place = () => {
      queued = false;
      for (const p of pins) p.classList.remove("no-name");
      const box = (n) => { const r = n.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
      const keep = FP.farmModel.labelsToShow(pins.map((p) => ({ label: box(p.querySelector("span")), dot: box(p.querySelector("i")) })));
      pins.forEach((p, n) => p.classList.toggle("no-name", !keep[n]));
    };
    declutter = () => { if (!queued) { queued = true; requestAnimationFrame(place); } };
    for (const ev of ["move", "resize"]) map.on(ev, declutter);
    place();
    const wide = window.innerWidth > 800;
    fit(union(boxes), wide ? { top: 90, left: 480, bottom: 90, right: 110 } : { top: 80, left: 85, bottom: Math.round(window.innerHeight * 0.5), right: 85 });
  }

  const area = (b) => (b[1][0] - b[0][0]) * (b[1][1] - b[0][1]);
  function bbox(geom) {
    let w = 180, s = 90, e = -180, n = -90;
    const walk = (c) => (typeof c[0] === "number" ? ([w, s, e, n] = [Math.min(w, c[0]), Math.min(s, c[1]), Math.max(e, c[0]), Math.max(n, c[1])]) : c.forEach(walk));
    walk(geom.coordinates);
    return [[w, s], [e, n]];
  }

  async function open(farmId, supplied = null, { show = null } = {}) {
    const request = ++opening;
    init();
    const { data, error } = supplied ? { data: supplied, error: null } : await FP.sb.rpc("farm_map", { f: farmId });
    if (error) throw error;
    if (!data) return null;
    await loaded();
    if (request !== opening) return null;
    clear(); framed = null;
    const entries = [];   // what the layer list shows: {key, name, sub, ids, on, markers, job}

    if (data.extent) {
      source("extent", { type: "Feature", geometry: data.extent, properties: {} });
      entries.push({ key: "extent", name: "Farm boundary", sub: FP.ha(data.extent_ha), section: "farm", on: true,
        ids: [layer({ id: "extent-line", type: "line", source: "extent", paint: { "line-color": accent(), "line-width": 3 } })] });
    }
    source("titles", data.titles);
    const titleIds = [layer({ id: "titles-line", type: "line", source: "titles",
      paint: { "line-color": "#ffffff", "line-width": 1.5, "line-dasharray": [2, 1.5] } }),
      layer({ id: "titles-hit", type: "fill", source: "titles", paint: { "fill-color": "#fff", "fill-opacity": 0 } },
        (f) => ({ title: `Title ${f.properties.title_no}`, layerName: "Record of title", qualifier: f.properties.source ? `Source: ${f.properties.source}` : null,
                  props: { area_ha: f.properties.area_ha, estate: f.properties.estate } }))];
    const titleHa = data.titles.features.reduce((a, f) => a + (Number(f.properties.area_ha) || 0), 0);
    entries.push({ key: "titles", name: "Titles", sub: titleHa ? FP.ha(titleHa) : null, section: "farm", on: true, ids: titleIds });

    data.layers.forEach((l, i) => source(`fl-${i}`, l.features));
    source("land-units", data.land_units);
    const layerIds = data.layers.map(() => []);
    for (const pass of ["polygon", "line", "point"]) {
      data.layers.forEach((l, i) => layerIds[i].push(...farmLayer(l, i, pass)));
    }
    data.layers.forEach((l, i) => {
      // one plain name and the one line saying where the layer came from; how many features it holds is not for the reader
      const e = { key: l.theme, name: FP.farmModel.layerName(l), sub: FP.farmModel.sourceLine(l), section: "farm", ids: layerIds[i], job: l.job || null };
      if (l.theme === "land_units") {
        landUnitLabels(data.land_units, data.extent);
        e.markers = markers.slice();
        e.ids.push(layer({ id: "land-units-hit", type: "fill", source: "land-units", paint: { "fill-color": "#000", "fill-opacity": 0 } },
          (f) => ({ title: `${f.properties.code} ${f.properties.name || ""}`.trim(), qualifier: FP.farmModel.sourceLine(l),
                    props: { area_ha: f.properties.area_ha } })));
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
      const id = layer({ id: sid + "-pt", type: "circle", source: sid, paint: {
        "circle-color": "#1e88e5", "circle-radius": 7, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } },
        (f) => ({ title: `${r.theme === "wells" ? "Bore" : r.name} ${f.properties.external_id}`, layerName: r.name,
                  qualifier: f.properties.on_farm ? "On the farm" : "Off the farm, linked to the farm's permit",
                  props: f.properties, permits: f.properties.authorisations || [], attribution: r.attribution }));
      entries.push({ key: "reference", name: r.theme === "wells" ? "Bores on the farm" : FP.farmModel.layerName(r), sub: null, section: "reference", ids: [id] });
    }

    // What an answer is about, drawn over everything when one of its lines is chosen (focus).
    source("focus", { type: "FeatureCollection", features: [] });
    layer({ id: "focus-fill", type: "fill", source: "focus", filter: ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]], paint: { "fill-color": accent(), "fill-opacity": 0.2 } });
    layer({ id: "focus-line", type: "line", source: "focus", filter: ["!", ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]]], paint: { "line-color": accent(), "line-width": 4 } });
    layer({ id: "focus-point", type: "circle", source: "focus", filter: ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]], paint: { "circle-color": accent(), "circle-radius": 8, "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
    drawn = data;

    // what's on when the farm opens comes from config.js (farmView.defaultOn); the rest is a tick away
    // (or from the block's show option, when its host chose)
    const defaultOn = new Set(show || [...(FP_CONFIG.farmView?.defaultOn || []), ...(FP.demo?.active ? ["actions"] : [])]);
    for (const e of entries) setVisible(e, defaultOn.has(e.key));

    if (data.extent) {
      map.resize();
      const b = bbox(data.extent);
      // The portfolio may already have started this zoom; it is kept unless a phone sheet covers part of the map.
      const sheet = inset();
      if (flightKey === JSON.stringify(b) && !sheet) { flightKey = null; framed = data.extent; touched = false; framedWidth = window.innerWidth; settle(data.extent); }
      else { flightKey = null; fit(b, FP.farmModel.framePadding(sheet, wide()), data.extent); }
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
    return { key: "actions", name: "Actions", ids, on: true, markers: actionMarkers, sub: null, section: "farm" };
  }

  function setVisible(entry, on) {
    entry.on = on;
    for (const id of entry.ids) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    for (const m of entry.markers || []) m.getElement().style.display = on ? "" : "none";
    if (entry.markers?.length && declutter) declutter();
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
  // A block's own surface goes when the block does: listeners, labels and the WebGL context with it.
  function remove() {
    if (!map) return;
    opening++; resizing++; framed = null; window.removeEventListener("resize", onResize); scheme?.removeEventListener("change", syncPalette); observer?.disconnect();
    for (const m of markers) m.remove();
    markers = []; added = []; interactive.clear(); map.remove(); map = null; ready = null;
  }
  return { open, portfolio, zoomTo, reframe, focus, project, camera: () => map && { zoom: map.getZoom(), center: map.getCenter().toArray(), moving: map.isMoving() }, setVisible, whenIdle, basemap: (k) => FP.basemaps.pick(init(), k), terrain: (on) => FP.basemaps.setTerrain(init(), on), frame: (geom) => { if (map && geom?.coordinates) map.fitBounds(bbox(geom), { padding: 55, duration: 400 }); }, addActions,
    resize: () => map && map.resize(), remove };
  }

  return { block, state, engine };
});

