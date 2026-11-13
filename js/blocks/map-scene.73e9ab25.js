// Map scene block: frames, draws and labels the scene it is handed, a farm_map payload (extent, titles, layers,
// land units, the shared reference features in the farm's context). Reference features are those around the farm
// (each source's context distance, DM1) or linked to its permits, each flagged on_farm / linked; radius analysis
// (distances for a job) is advisor-side job tooling and never drawn here (ARCHITECTURE.md "Reference data and how a
// farm sees it"). The block draws on a surface: its own map in the frame it is given, or a live one the
// host hands it as ctx.surface (the farm space keeps one map for the session, so the NZ -> farm zoom is unbroken).
// PERF1b: a farm's payload carries no reference features (farm_map's `reference` is []); the farm space reads each
// source when it is switched on (farm-reference.js) and hands it to the surface's addReference(entry), which joins it to
// the scene on the map without drawing the scene again. A payload that does carry reference entries (a group's map, a
// database before PERF1a) is drawn whole, as before.
// PERF3b: a group's map (group_map, PERF3a) may list a large layer of its own with no features (`deferred`): its row is
// drawn empty, and the group space reads its features for the map in view and hands them to layerData(entry, features);
// view() and onMoveEnd(fn) tell it what is in view.
// CAP1b: a farm's map (farm_map after CAP1a) does the same for a large farm-own layer, and layerData also fills a farm's
// reference source read for the map in view (its entry came truncated: drawn empty by addReference, then filled).
(function (root, factory) {
  const blocks = typeof module === "object" && module.exports ? require("./registry.js") : root.FP.blocks;
  const api = factory(blocks);
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP.mapScene = api; root.FP.farmMap = api.engine("map"); }
})(typeof window === "undefined" ? globalThis : window, function (blocks) {
  // LK4: the kind registry (app/layer-kinds.json via layer-kinds.js): draw order, default rules and kinds come from it.
  const K = () => (typeof module === "object" && module.exports ? require("../layer-kinds.js") : window.FP.kinds);
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
    if (ctx.surface) return ctx.surface.open(scene?.farm?.id ?? null, scene || emptyScene, { show: o.show, photo: o.photo });
    const canvas = host.querySelector(".map-scene-canvas");
    if (!canvas) return null;
    const surface = engine(canvas);
    ctx.onDestroy(() => surface.remove());
    return surface.open(scene.farm?.id ?? null, scene, { show: o.show, photo: o.photo }).then((view) => view && { ...view, surface });
  }
  const emptyScene = { extent: null, titles: { type: "FeatureCollection", features: [] }, land_units: { type: "FeatureCollection", features: [] }, layers: [], reference: [] };
  const block = blocks.define({
    id: "map-scene", title: "Map scene", empty: "No boundary recorded yet.",
    // show: what is drawn when the scene opens (extent, titles, a layer's theme, reference, actions); null keeps the farm's default.
    // photo: a photo point (its feature id) to open framed on, with its card and view cone (the gallery shows one).
    options: { show: { type: "list", default: null }, photo: { type: "string", default: null } },
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
  const unitHits = new Set();      // the land-units hit layers' ids (#411: one per land-units layer), ranked under other areas
  let declutter = null;            // the label-collision handler for what is drawn (portfolio pins, or a farm's land unit labels)
  const photoSets = new Map();     // farm layer index -> { layer, list (its photos in time order), markers }
  let photo = null;                // the photo open on the map: { i, k, card }
  let units = null;                // the scene's land units (a photo's card says which one it sits in)
  let featurePopup = null;         // the feature popup open on the map, if any
  let drawn = null;                // the farm payload on the map now, for focus()
  let farmZoom = null;             // the zoom the farm's own frame settled at (photo pins show once zoomed in past it)
  const photoEntries = [];         // the Photos rows: their pins are drawn by curatePins, not by setVisible alone
  let rivers = null;               // the Rivers row (DM2): its rows are read for the map in view while it is on

  // UI2: the farm's boundary and the other marks that used the accent keep a map colour of their own (the accent is ink now)
  const accent = () => getComputedStyle(document.documentElement).getPropertyValue("--map-boundary").trim() || "#4c9aff";

  let scheme = null, observer = null, syncPalette = null;
  function init() {
    if (map) return map;
    maplibregl.setWorkerUrl("vendor/maplibre-gl-csp-worker.f950e7b1.js");
    map = new maplibregl.Map({
      // UI2b: an overview map is made on the plain ground (no aerial), a farm's own map on the aerial
      container, style: FP.basemaps.style(startBase || "aerial"),
      bounds: [[166.3, -47.4], [178.6, -34.3]], maxZoom: 21,
      attributionControl: { compact: true, customAttribution: FP.brand.org_legal },
    });
    // (made on the plain ground for an overview: no background is drawn until the one asked for has come)
    base = startBase && startBase !== "aerial" && baseNames().includes(startBase) ? "ground" : "aerial";
    // #259: on a phone the attribution starts as the (i) and opens on tap (MapLibre starts a compact one open until the map
    // is first moved, which put two lines over the map above the sheet). Folded once the map is up, and again when a narrow
    // canvas follows a wide one; a person who opened it is not folded again while the canvas stays narrow.
    let narrow = null;
    const foldAttribution = () => {
      const now = FP.farmModel.isPhoneMap(map.getCanvasContainer().offsetWidth);
      if (now && now !== narrow) FP.farmModel.foldAttribution(map.getContainer().querySelector(".maplibregl-ctrl-attrib"));
      narrow = now;
    };
    foldAttribution(); map.once("load", foldAttribution); map.on("resize", foldAttribution);
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
    ready.then(() => { if (styleAt == null) styleAt = performance.now(); });   // TIM1: when the style was loaded (a route's `style` step)
    // UI colours follow the same tokens as the shell, including a live OS/theme change.
    syncPalette = () => ready.then(() => {
      if (!map) return;
      if (map.getLayer("bm-blank")) map.setPaintProperty("bm-blank", "background-color",
        getComputedStyle(document.documentElement).getPropertyValue("--map-background").trim());
      for (const [id, property] of [["portfolio-fill", "fill-color"], ["portfolio-line", "line-color"],
        ["extent-line", "line-color"], ["action-programme-lines", "line-color"], ["action-programme-points", "circle-color"]]) {
        if (id === "extent-line" && quiet) continue;   // UI2: a group's outline is in its own hue
        if (map.getLayer(id)) map.setPaintProperty(id, property, accent());
      }
      paletteChanged();
    });
    scheme = window.matchMedia("(prefers-color-scheme: dark)"); scheme.addEventListener("change", syncPalette);
    observer = new MutationObserver(syncPalette); observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
    const taken = () => { settling++; touched = true; };   // the person has taken the camera
    for (const ev of ["dragstart", "zoomstart", "rotatestart", "pitchstart"]) map.on(ev, (e) => { if (e.originalEvent) taken(); });
    // #407: so have three moves MapLibre (5.24) starts with no originalEvent: a wheel or trackpad zoom (its zoomstart), a
    // shift-drag box zoom (fitScreenCoordinates after boxzoomstart) and the Locate me button and its tracking (geolocateSource).
    // Without these the map was framed again after the person moved it: the re-ground (250 ms after each rest, with the hills
    // in 3D), a window resize and a settle still waiting for idle all took the camera to be the frame's.
    // (A wheel that zooms nothing, a horizontal two-finger swipe, leaves the camera to the frame: MapLibre ignores it too.)
    map.getCanvasContainer().addEventListener("wheel", (e) => { if (e.deltaY || e.ctrlKey) taken(); }, { passive: true });
    map.on("boxzoomstart", taken);
    map.on("movestart", (e) => { if (e.geolocateSource) taken(); });
    window.addEventListener("resize", onResize);
    map.on("click", onClick);
    map.on("moveend", reground);
    // the zoom the farm's own frame settled at, and the photo pins curated against it (FP.photoModel.pinsShown)
    map.on("moveend", () => { if (map && !touched && !photo && drawn?.extent && framed === drawn.extent && !map.isMoving()) farmZoom = map.getZoom(); curatePins(); });
    map.on("zoomend", curatePins);
    map.on("moveend", readRivers);
    map.on("data", (e) => { if (e.sourceId && e.sourceId === map?.getTerrain?.()?.source) reground(); });
    map.on("mousemove", (e) => {
      const ids = [...interactive.keys()].filter((id) => map.getLayer(id));
      map.getCanvas().style.cursor = ids.length && map.queryRenderedFeatures(e.point, { layers: ids }).length ? "pointer" : "";
    });
    return map;
  }

  const loaded = () => ready;

  // ---- UI2: the overview maps' calm look (the home Places map and a group's Overview) ------------------------------------
  // They open on the plain map (LINZ's light Topolite) with the aerial one tap away, the person's choice kept on this device; a
  // farm's own detailed map keeps opening on the aerial (the Layers drawer's choice, main.js). Places and member blocks are
  // drawn in soft hues (map-palette.js): thin outlines of the hue over a subtle casing, gentle fills. The demo has no
  // background tiles: its plain ground is the map background token.
  const OVERVIEW_BASE = "fp-overview-basemap";
  const baseNames = () => FP.basemaps?.names || [];
  // The backgrounds an overview offers: LINZ's, or (the demo, which fetches no tiles) the same two choices over the plain ground,
  // so the choice can be made and seen without a key
  const choices = () => (baseNames().length >= 2 ? baseNames() : FP.demo?.active ? ["topolite", "aerial"] : []);
  // base: the background drawn now ("ground" while none is); want: the one asked for, the only one the switch marks;
  // startBase: the background a map not made yet opens on
  let base = "aerial", want = null, startBase = null, asks = 0, farmBase = "aerial", quiet = null, quietOff = null, paletteHooks = [], bgControl = null;
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const darkTheme = () => /dark/.test(getComputedStyle(document.documentElement).colorScheme || "");
  // Lines and labels are drawn for a dark ground on the aerial, or on the plain ground of a dark theme where there are no tiles
  const onDark = () => (FP.basemaps?.missingKey !== false ? darkTheme() : base === "aerial" || (base === "ground" && darkTheme()));
  // UI2b: with nothing stored, the plain map (map-palette.js startBackground); the stored choice wins
  function overviewBase() {
    let k = null;
    try { k = localStorage.getItem(OVERVIEW_BASE); } catch { /* no storage: the default */ }
    return FP.mapPalette.startBackground(k, choices());
  }
  // The background asked for is the one marked at once; until it is drawn the map shows its plain ground, never the one before.
  // If it can't be drawn (the style couldn't be fetched) the aerial is drawn and marked instead, and the console says why.
  async function useBase(k) {
    if (!choices().includes(k) && k !== "aerial") return;
    want = k; markBg();
    if (k === base) return;
    const mine = ++asks;
    if (!baseNames().includes(k)) { base = k; paletteChanged(); return; }   // the demo: the plain ground stands for every background
    const m = init();
    if (k !== "aerial") { FP.basemaps.ground?.(m); base = "ground"; }
    try { await FP.basemaps.pick(m, k); }
    catch (e) {
      console.warn("The " + k + " background couldn't be drawn:", e?.message || e);
      if (mine !== asks) return;
      want = "aerial"; markBg();
      try { await FP.basemaps.pick(m, "aerial"); base = "aerial"; } catch { base = "ground"; }
      paletteChanged(); return;
    }
    if (mine !== asks) return;
    base = k; markBg(); paletteChanged();
  }
  function paletteChanged() { for (const f of paletteHooks) { try { f(); } catch { /* a hook for a map already cleared */ } } }
  // A small floating Map | Aerial switch, on the overview maps only
  function markBg() { for (const b of bgControl?.querySelectorAll("button") || []) b.setAttribute("aria-pressed", String(b.dataset.base === want)); }
  function showBg(on) {
    if (choices().length < 2) return;
    if (on && !bgControl) {
      bgControl = FP.el("div", { class: "maplibregl-ctrl map-bg-switch", role: "group", "aria-label": "Background" },
        ...[["topolite", "Map"], ["aerial", "Aerial"]].filter(([k]) => choices().includes(k)).map(([k, label]) =>
          FP.el("button", { type: "button", "data-base": k, onclick: () => { try { localStorage.setItem(OVERVIEW_BASE, k); } catch { /* kept for this visit */ } useBase(k); } }, label)));
      init().addControl({ onAdd: () => bgControl, onRemove: () => {} }, "top-right");
    }
    if (bgControl) bgControl.hidden = !on;
    markBg();
  }
  // The background a scene opens on: an overview's (the plain map unless the person chose the aerial), or the farm's own
  function overviewMode(on) { if (on) want = overviewBase(); showBg(on); useBase(on ? want : farmBase); }

  // ---- TIM1 (#410): the outline at once, and when it was first on screen -----------------------------------------------
  // styleAt: when this map's style finished loading (performance.now()); outlineAt: when the open scene's outline was first
  // on screen, by the sketch below or by the map's own extent layer (outlineShown() waits for it). hasShown: this map has drawn
  // a farm, a group or the portfolio, so it is not black and has somewhere to fly from.
  let styleAt = null, outlineAt = null, outlineWaiters = [], hasShown = false, sketchNode = null, sketched = null, offSketch = null;
  function outlineSeen(at = performance.now()) {
    if (outlineAt != null) return;
    outlineAt = at;
    for (const res of outlineWaiters.splice(0)) res(at);
  }
  const outlineShown = () => new Promise((res) => (outlineAt != null ? res(outlineAt) : outlineWaiters.push(res)));
  // The farm's boundary on screen the moment farm_map is back, instead of a black map while the style, the tiles and a
  // flight in from all of New Zealand come. Only on a map that has shown nothing yet (a page opened on a farm): the camera
  // is put on the farm's frame at once (there is nothing on the map to fly from), and the boundary drawn over the canvas as
  // a plain SVG line, following the camera, until the map paints its own (open: the extent layer). True when it sketched.
  function sketch(extent) {
    outlineAt = null;
    if (hasShown || !extent?.coordinates) return false;
    init(); map.resize();
    removeSketch();
    const b = bbox(extent);
    fit(b, FP.farmModel.framePadding(inset(), wide()), null, 0);
    touched = false;   // the farm's frame, from here: a wheel or drag from now on is the person's (open keeps it)
    sketched = JSON.stringify(b);
    const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"), path = document.createElementNS(ns, "path");
    svg.setAttribute("class", "map-sketch"); svg.setAttribute("aria-hidden", "true"); svg.append(path);
    const draw = () => { if (map) path.setAttribute("d", sketchPath(extent)); };
    draw();
    map.getContainer().append(svg); sketchNode = svg;
    map.on("move", draw); offSketch = () => map?.off("move", draw);
    // on screen once the frame it was added in has been painted
    requestAnimationFrame(() => requestAnimationFrame(() => { if (sketchNode === svg) outlineSeen(); }));
    return true;
  }
  function sketchPath(geom) {
    const rings = geom.type === "Polygon" ? geom.coordinates : geom.type === "MultiPolygon" ? geom.coordinates.flat() : [];
    return rings.map((ring) => ring.map((c, i) => { const p = map.project(c); return (i ? "L" : "M") + p.x.toFixed(1) + " " + p.y.toFixed(1); }).join("") + "Z").join("");
  }
  function removeSketch() { offSketch?.(); offSketch = null; sketchNode?.remove(); sketchNode = null; sketched = null; }
  // When the map has painted a source (its data loaded and a frame rendered with it); a newer open stops the wait.
  function painted(id, request) {
    return new Promise((res) => {
      const check = () => {
        if (request !== opening || !map) { map?.off("render", check); return; }
        if (map.getSource(id) && map.isSourceLoaded(id)) { map.off("render", check); res(performance.now()); }
      };
      map.on("render", check); map.triggerRepaint();
    });
  }

  function clear() {
    if (photo) closePhoto();   // (and the hills come back if a photo had flattened them)
    photo?.card.remove(); photo = null; photoSets.clear(); units = null; featurePopup?.remove(); featurePopup = null;
    if (declutter) { for (const ev of ["move", "resize"]) map.off(ev, declutter); declutter = null; }
    homeOff?.(); homeOff = null;   // LP1: the home map's own listeners and hover name
    quietOff?.(); quietOff = null; quiet = null; paletteHooks = [];   // UI2: the overview's calm look and its hover
    if (offLine) { map.off("move", offLine); offLine = null; }
    for (const m of markers) m.remove();
    markers = [];
    for (const { kind, id } of [...added].reverse()) {
      if (kind === "layer" && map.getLayer(id)) map.removeLayer(id);
      if (kind === "source" && map.getSource(id)) map.removeSource(id);
    }
    added = []; drawnSpecs.clear(); slots = [];
    interactive.clear(); unitHits.clear(); sourceData.clear(); saved.clear(); refKeys.clear();
    drawn = null; farmZoom = null; masked = false; photoEntries.length = 0; rivers = null; refDrawn = [];
  }

  // Rivers for the map in view (DM2): read once the map has come to rest, while the row is on, unless the last read's
  // box already holds the view at the same stream-order cut. A read overtaken by a newer one is dropped.
  // ahead === true: read while the row is off (PERF1b's idle prefetch), so switching it on draws from what is already
  // here (a moveend event passed in is not that).
  async function readRivers(ahead) {
    const r = rivers;
    if (!map || !(r?.on || ahead === true) || !map.getSource("rivers")) return;
    const b = map.getBounds(), bounds = [[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]], zoom = map.getZoom();
    const want = FP.farmModel.riverBox(bounds, zoom);
    if (!want) { r.read = null; map.getSource("rivers").setData(NONE); return; }
    if (FP.farmModel.riverBoxCovers(r.read, bounds, zoom)) return;
    const mine = ++r.asked;
    const { data, error } = await FP.sb.rpc("waterways_in_view", want);
    if (mine !== r.asked || r !== rivers || !map?.getSource("rivers")) return;
    if (error) { console.warn("Rivers could not be read:", error.message || error); return; }
    r.read = want;
    map.getSource("rivers").setData(FP.farmModel.riverFeatures(data));
  }

  function source(id, data) {
    map.addSource(id, { type: "geojson", data: withEdits(id, data) });
    added.push({ kind: "source", id });
    sourceData.set(id, data);
  }
  // GE1b: what each source was given (so the shape editor can find a feature's box), and the shapes a person saved this
  // session, drawn in place of the read ones: a viewport read kept from before the save (group-layers.js) draws the new shape.
  const sourceData = new Map(), saved = new Map();   // source id -> data; source id + "|" + feature id -> geometry
  function withEdits(id, data) {
    if (!saved.size || !Array.isArray(data?.features)) return data;
    let hit = false;
    const features = data.features.map((f) => { const g = f?.id != null && saved.get(id + "|" + f.id); if (!g) return f; hit = true; return { ...f, geometry: g }; });
    return hit ? { ...data, features } : data;
  }
  function featureData(layerIndex, id) {
    const data = sourceData.get("fl-" + layerIndex), f = data?.features?.find?.((x) => x?.id != null && String(x.id) === String(id));
    return f ? { ...f, geometry: saved.get("fl-" + layerIndex + "|" + f.id) || f.geometry } : null;
  }
  function patchFeature(layerIndex, id, geometry) {
    const sid = "fl-" + layerIndex, src = map?.getSource(sid);
    if (!src || id == null || !geometry) return false;
    saved.set(sid + "|" + id, geometry);
    src.setData(withEdits(sid, sourceData.get(sid) || NONE));
    return true;
  }
  function layer(spec, describe, before) {
    // LK4: labels go after all geometry (under the photo cone and the focus mark); geometry where its group is being drawn
    const at = spec.type === "symbol" && map.getLayer("z-top") ? "z-top" : before ?? insertAt;
    if (at && map.getLayer(at)) map.addLayer(spec, at); else map.addLayer(spec);
    added.push({ kind: "layer", id: spec.id });
    drawnSpecs.set(spec.id, spec);   // LK2: as drawn, so a restyle can unset what a new look no longer sets
    if (describe) interactive.set(spec.id, describe);
    return spec.id;
  }
  const drawnSpecs = new Map();
  // ---- Draw order (LK4) --------------------------------------------------------------------------------------------------------------
  // Every map layer is inserted by its kind's tier (0 basemap … 10 annotations): within a tier, owned above shared, newer as_at
  // above older, then sort_order (FP.kinds.orderKey). Labels go after all geometry. Two hidden anchors mark the bands: data
  // under "z-labels", labels under "z-top"; the photo cone and the focus mark are drawn over "z-top", on top of the data.
  let slots = [], insertAt;   // what is drawn ({order, first: its lowest layer id}); the layer the group being drawn goes under
  function drawGroup(order, fn) {
    const before = K().insertBefore(slots, order, (id) => !!map.getLayer(id)) || (map.getLayer("z-labels") ? "z-labels" : undefined);
    const was = insertAt, n = added.length;
    insertAt = before;
    let out;
    try { out = fn(); } finally { insertAt = was; }
    const first = added.slice(n).find((a) => a.kind === "layer" && drawnSpecs.get(a.id)?.type !== "symbol")?.id;
    if (first && !restyling) slots.push({ order, first });
    return out;
  }
  function anchors() {
    for (const id of ["z-labels", "z-top"]) layer({ id, type: "background", layout: { visibility: "none" }, paint: {} });
  }
  // A drawn thing's order: a farm (or group) layer, a reference source (its as-at date from reference_sources), or a kind.
  const shownLayer = (l) => K().isData(l) && K().defaultRule(l.theme, l.geometry_type) !== "never";
  const layerOrder = (l, i) => K().orderKey({ theme: l.theme, geometry: l.geometry_type, owned: true, as_at: l.as_at, sort_order: l.sort_order ?? i });
  const refOrder = (r, sources) => { const s = (sources || []).find((x) => x?.key === r.key); return K().orderKey({ kind: K().refKindOf(r.theme), owned: false, as_at: s?.refreshed_at || s?.effective_from || r.as_at || null }); };
  // LK4: a second shared context fill on at once is drawn as an outline and hatch (no solid fill), so the overlap reads; and
  // back to its own look when it is the only one again. Kept over a restyle.
  function hatch() {
    if (map.hasImage?.("fp-hatch")) return;
    const n = 8, data = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if ((x + y) % n === 0 || (x + y) % n === n - 1) data.set([255, 255, 255, 200], (y * n + x) * 4);
    map.addImage?.("fp-hatch", { width: n, height: n, data });
  }
  function setStacked(entry, on) {
    if (!map || !entry || (!on && !entry.stacked)) return;   // (most rows are never stacked: nothing to put back)
    entry.stacked = !!on;
    if (on) hatch();
    for (const id of entry.ids || []) {
      const spec = drawnSpecs.get(id);
      if (!spec || !map.getLayer(id)) continue;
      if (spec.type === "fill" && /-fill$/.test(id)) {
        map.setPaintProperty(id, "fill-pattern", on && map.hasImage?.("fp-hatch") ? "fp-hatch" : undefined);
        map.setPaintProperty(id, "fill-opacity", on ? 0.5 : spec.paint?.["fill-opacity"] ?? 0.25);
      } else if (spec.type === "line" && /-(outline|line)$/.test(id)) {
        map.setPaintProperty(id, "line-dasharray", on ? [2, 1.5] : spec.paint?.["line-dasharray"]);
      }
    }
  }

  // The two sources behind the shared Rivers layer, with the name to use if their rows cannot be read (PROV1).
  const RIVER_SOURCES = [["niwa-rec2-rivers", "River network (REC2), NIWA"], ["linz-topo50-river-centrelines", "River lines (Topo50), LINZ"]];
  // A layer's advisor note (LN1), as its info panel shows it: each part from the narrowest note that has one.
  const noteFor = (key) => FP.layerNotes?.applicable(drawn?.layer_notes, key, drawn?.viewer) || null;

  // Reference layers, each drawn by its geometry (#243): lines as light blue lines on a dark casing, areas as a fill
  // and outline, points as circles; one describe per layer, so every popup says what it is and where it came from.
  // Consents: current ones only, until "Past consents" adds the rest (the row's own second switch). `before`: the
  // MapLibre layer they go under (none while the scene is drawn: they are drawn in the payload's order).
  const AREA = ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]], LINE = ["in", ["geometry-type"], ["literal", ["LineString", "MultiLineString"]]],
    POINT = ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]];
  let refDrawn = [], refAdded = 0;   // the reference sources on the map, in drawing order ({key, name, first layer id}); sources added since
  const refKeys = new Map();   // GE1b: reference source id -> its key
  function referenceLayers(r, sid, key, before) {
    const consents = K().refKindOf(r.theme) === "consents" || r.key === "ecan-consents";
    const features = consents ? { ...r.features, features: (r.features?.features || []).map((f) => ({ ...f, properties: { ...f.properties, fp_past: FP.farmModel.pastConsent(f.properties) } })) } : r.features;
    source(sid, features);
    const describe = (f) => {
      const { fp_past, ...props } = f.properties;
      // DM1: the farm map shows each layer around the farm too, so off the farm is "near" unless linked to a permit
      // a group's map (S5) flags what is in or near the group's area instead
      const where = props.in_area ? "In or near the group's area" : props.on_farm ? "On the farm" : props.linked ? "Off the farm, linked to the farm's permit" : "Near the farm";
      // PROV1: the source, provider, as-at date and licence from reference_sources (drawn.sources), in every reference popup
      const provenance = FP.provenance?.lineFor(drawn?.sources, r.key, r) || null;
      if (consents) return { ...FP.farmModel.consentPopup(props, r, where), note: noteFor("source:" + r.key), provenance };
      const named = props.name || props.Name || props.NAME;
      return { title: named ? String(named) : `${K().refKindOf(r.theme) === "wells" ? "Bore" : FP.farmModel.layerName(r)} ${props.external_id ?? ""}`.trim(), layerName: FP.farmModel.layerName(r),
        qualifier: where, props, permits: props.authorisations || [], attribution: r.attribution, note: noteFor("source:" + r.key), provenance };
    };
    // LK1: today's look (#243), unless a reviewed record (or a preview's) gives this source, or its theme, another
    const { record, look } = refLookFor(r), z = zoomsOf(record);
    const A = look?.area || { fill: "#bfe8ff", fillOpacity: 0.25, line: "#bfe8ff", lineWidth: 1.5 }, L = look?.line || { line: "#bfe8ff", lineWidth: 2.5 },
      P = look?.point || { fill: "#1e88e5", radius: 7, line: "#ffffff" };
    const op = (s) => (s.lineOpacity !== undefined ? { "line-opacity": s.lineOpacity } : {});
    const ids = [
      layer({ id: sid + "-fill", type: "fill", source: sid, ...z, filter: AREA, paint: { "fill-color": A.fill, "fill-opacity": A.fillOpacity } }, describe, before),
      layer({ id: sid + "-outline", type: "line", source: sid, ...z, filter: AREA, paint: { "line-color": A.line, "line-width": A.lineWidth, ...op(A) } }, null, before),
      layer({ id: sid + "-casing", type: "line", source: sid, ...z, filter: LINE, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#000000", "line-opacity": 0.5, "line-width": record ? plus(L.lineWidth, 2.5) : 5 } }, null, before),
      layer({ id: sid + "-line", type: "line", source: sid, ...z, filter: LINE, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": L.line, "line-width": L.lineWidth, ...op(L), ...(L.dash ? { "line-dasharray": L.dash } : {}) } }, describe, before),
      layer({ id: sid + "-pt", type: "circle", source: sid, ...z, filter: consents ? ["all", POINT, ["!=", ["get", "fp_past"], true]] : POINT, paint: {
        "circle-color": P.fill, "circle-radius": P.radius, "circle-stroke-color": P.line, "circle-stroke-width": 2 } }, describe, before),
      ...labelLayer(record, sid, before),
    ];
    const past = consents ? [layer({ id: sid + "-past", type: "circle", source: sid, filter: ["all", POINT, ["==", ["get", "fp_past"], true]], paint: {
      "circle-color": "#78909c", "circle-radius": 6, "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5 } }, describe, before)] : null;
    if (!restyling) refDrawn.push({ key, name: String(r.name || key), first: ids[0], sid, r });   // (LK2: sid and r, for a restyle)
    refKeys.set(sid, r.key || key);   // GE1b: a tap on it is on a shared reference layer (the shape editor says it isn't edited)
    const purpose = record ? FP.layerStyle.purpose(record) : null;   // LK1: the Layers list's sentence, when the record has one
    return { key, name: FP.farmModel.layerName(r), sub: null, section: "reference", ids, kind: K().refKindOf(r.theme), theme: r.theme ?? null, geometry: geometryOf(r.features),
      ...(past ? { past: { ids: past, on: false } } : {}), ...(purpose ? { purpose } : {}) };
  }
  // PERF1b: one reference source's entry (farm_reference_context's shape, as farm_map gave it) joins the scene on the map
  // now, without drawing it again: at its kind's tier among what is drawn (LK4), under the labels, the photo cone and the
  // focus mark. Drawn hidden: the host turns it on (setVisible) as its row says. Returns the row's layer ids
  // ({key, name, ids, past?}), or null when no farm is drawn or the source is already on the map (nothing is added; the host keeps the row it has).
  function addReference(r) {
    if (!map || !drawn || !r?.key) return null;
    const had = refDrawn.find((x) => x.key === r.key);
    if (had) return null;
    // LK4: by its kind's tier among what is drawn (never by name)
    const order = refOrder(r, drawn.sources);
    const row = drawGroup(order, () => referenceLayers(r, "ref-on-" + ++refAdded, r.key));
    Object.assign(row, { order });
    refDrawn.find((x) => x.key === r.key).row = row;   // LK2: the row the host switches, for a restyle
    if (!(drawn.reference || []).some((x) => x.key === r.key)) drawn.reference = [...(drawn.reference || []), r];   // focus() and popups find it
    setVisible(row, false);
    return row;
  }

  // LK1 (#416): the looks this scene draws with (layer-style.js): the reviewed records the payload carries (`styles`, from
  // public.layer_styles_for_map), and the records a preview shows (open's stylePreview; nothing else ever passes one).
  // With no record a layer is drawn exactly as before: its QGIS style, then today's rule.
  let looks = { styles: [], preview: null };
  // LK2 (review-444 follow-up 4): a host draws its map without waiting for the looks; looks that come after it was drawn are
  // applied here to the layers already on the map, exactly as open would have drawn them: the same farmLayer and
  // referenceLayers, drawing on a stand-in for the map (`restyling`) on which no source is added again and a layer already
  // there takes the new paint, layout and zoom range. A label layer the look adds is shown or hidden as its row's other
  // layers are, and joins that row's switch. The preview's records are kept as they were. False when nothing is drawn.
  let restyling = false, drawnEntries = [];
  function restyle(styles) {
    if (!map || !drawn) return false;
    looks = { ...looks, styles: Array.isArray(styles) ? styles : [] };
    drawn.styles = looks.styles;
    const real = map, fresh = new Set();
    // (a paint or layout key the layer was drawn with that the new spec lacks is unset: a fresh draw would not have it)
    const restyleLayer = (spec) => {
      const was = drawnSpecs.get(spec.id) || {};
      for (const k of Object.keys(was.paint || {})) if (!(k in (spec.paint || {}))) real.setPaintProperty(spec.id, k, undefined);
      for (const k of Object.keys(was.layout || {})) if (k !== "visibility" && !(k in (spec.layout || {}))) real.setLayoutProperty(spec.id, k, undefined);
      for (const [k, v] of Object.entries(spec.paint || {})) real.setPaintProperty(spec.id, k, v);
      for (const [k, v] of Object.entries(spec.layout || {})) if (k !== "visibility") real.setLayoutProperty(spec.id, k, v);
      real.setLayerZoomRange?.(spec.id, spec.minzoom ?? 0, spec.maxzoom ?? 24);
      drawnSpecs.set(spec.id, spec);
    };
    // A layer new to the map goes where open would have put it: before the next layer the replay finds already drawn, or
    // (at the end of a layer's or a source's replay) just after the last one it found.
    let pending = [], last = null;
    const place = (beforeId) => { for (const s of pending) real.addLayer(s, beforeId); pending = []; };
    const flush = () => {
      if (!pending.length) return;
      const ids = (real.getStyle()?.layers || []).map((l) => l.id), next = last ? ids[ids.indexOf(last) + 1] : undefined;
      place(next && real.getLayer(next) ? next : undefined);
    };
    const stand = new Proxy(real, { get(t, k) {
      if (k === "addSource") return () => {};
      if (k === "addLayer") return (spec) => {
        if (t.getLayer(spec.id)) { restyleLayer(spec); place(spec.id); last = spec.id; }
        else if (spec.type === "symbol" && t.getLayer("z-top")) { fresh.add(spec.id); t.addLayer(spec, "z-top"); }   // LK4: labels after all geometry
        else { fresh.add(spec.id); pending.push(spec); }
      };
      const v = t[k];
      return typeof v === "function" ? v.bind(t) : v;
    } });
    const join = (e, ids, purpose) => {
      if (!e) return;
      const shown = e.ids.find((id) => !fresh.has(id) && real.getLayer(id));
      const vis = (shown && real.getLayoutProperty?.(shown, "visibility")) || (e.on ? "visible" : "none");
      for (const id of ids) if (!e.ids.includes(id)) { e.ids.push(id); if (real.getLayer(id)) real.setLayoutProperty(id, "visibility", vis); }
      if (purpose) e.purpose = purpose; else delete e.purpose;
    };
    const before = added.length;
    restyling = true; map = stand;
    try {
      const layers = drawn.layers || [], byIndex = layers.map(() => []);
      for (const pass of ["polygon", "line", "point"]) layers.forEach((l, i) => { if (shownLayer(l)) byIndex[i].push(...farmLayer(l, i, pass)); });
      flush();
      const rows = refDrawn.map((d) => { last = null; const row = referenceLayers(d.r, d.sid, d.key); flush(); return [d, row]; });
      map = real;
      layers.forEach((l, i) => {
        const rec = FP.layerStyle ? lookFor(l).record : null;
        join(drawnEntries.find((e) => e.layerIndex === i), byIndex[i], rec ? FP.layerStyle.purpose(rec) : null);
      });
      for (const [d, row] of rows) join(d.row || drawnEntries.find((e) => e.section === "reference" && e.key === d.key), row.ids, row.purpose || null);
    } finally { restyling = false; map = real; }
    for (const e of [...drawnEntries, ...refDrawn.map((d) => d.row)]) if (e?.stacked) setStacked(e, true);   // LK4: a stacked fill stays hatched
    // only the layers new to the map are kept as added (the rest were already: clear() removes each once)
    added = [...added.slice(0, before), ...added.slice(before).filter((a) => a.kind === "layer" && fresh.has(a.id))];
    return true;
  }
  const lookFor = (l) => (FP.layerStyle ? FP.layerStyle.forLayer(l, looks.styles, looks) : { record: null, look: FP.qml.style(l) });
  const refLookFor = (r) => (FP.layerStyle ? FP.layerStyle.forReference(r, looks.styles, looks) : { record: null, look: null });
  const zoomsOf = (record) => (record && FP.layerStyle ? FP.layerStyle.range(record) : {});
  // A record's labels, as a symbol layer over the rest (only with the basemap's glyphs, as the river names).
  function labelLayer(record, sid, before) {
    const lab = record && FP.layerStyle?.label(record);
    if (!lab || !map.getStyle()?.glyphs) return [];
    const z = zoomsOf(record), minzoom = lab.minzoom ?? z.minzoom;
    return [layer({ id: sid + "-label", type: "symbol", source: sid, ...z, ...(minzoom != null ? { minzoom } : {}),
      layout: { "text-field": FP.layerStyle.labelText ? FP.layerStyle.labelText(lab) : ["to-string", ["get", lab.field]], "text-font": ["Open Sans Regular"], "text-size": 12, "text-padding": 4, "text-allow-overlap": false },
      paint: { "text-color": "#ffffff", "text-halo-color": "rgba(0, 0, 0, 0.6)", "text-halo-width": 1.2 } }, null, before)];
  }
  // a reference source's geometry, from its features (none read yet: polygon, so a zone's row is a fill)
  const geometryOf = (fc) => { const t = (fc?.features || []).find((f) => f?.geometry)?.geometry?.type || ""; return /Polygon/.test(t) ? "polygon" : /Line/.test(t) ? "line" : /Point/.test(t) ? "point" : null; };
  const plus = (v, n) => (typeof v === "number" ? v + n : ["+", v, n]);
  const atMost = (v, n) => (typeof v === "number" ? Math.min(v, n) : ["min", v, n]);

  // UI2: the group's look (its hue, from its own id or its parent's: data.palette, group-space.js), read again when the theme or
  // the background changes
  function quietLook(data) {
    const P = FP.mapPalette, key = data.palette?.key || data.group?.id || data.farm?.id, sub = !!data.palette?.sub;
    const q = { look: () => P.look(P.hues(cssVar)[P.hueIndex(key)], { sub, onDark: onDark() }), layers: [] };
    paletteHooks.push(() => {
      if (quiet !== q || !map) return;
      const lk = q.look(), set = (id, p, v) => { if (map.getLayer(id)) map.setPaintProperty(id, p, v); };
      set("extent-casing", "line-color", lk.casing); set("extent-line", "line-color", lk.line);
      for (const sid of q.layers) {
        set(sid + "-fill", "fill-color", lk.fill); set(sid + "-hl", "fill-color", lk.fill); set(sid + "-casing", "line-color", lk.casing);
        set(sid + "-line", "line-color", lk.line); set(sid + "-lease", "line-color", lk.line);
        set(sid + "-label", "text-color", onDark() ? "#ffffff" : "#1d1d1f"); set(sid + "-label", "text-halo-color", onDark() ? "rgba(0, 0, 0, 0.6)" : "rgba(255, 255, 255, 0.9)");
      }
    });
    return q;
  }
  // A member block counts as leased when its `leased` says yes (yes, y, true or 1, any case; empty is not leased: HDLG's blocks carry
  // "Yes" or nothing); only a block with no `leased` at all looks at a tenure, ownership or status that mentions a lease. The same
  // rule as map-palette.js isLeased (tests/app/ui2.test.cjs).
  const LEASED = ["case", ["has", "leased"], ["in", ["downcase", ["to-string", ["get", "leased"]]], ["literal", ["yes", "y", "true", "1"]]],
    ["in", "lease", ["downcase", ["to-string", ["coalesce", ["get", "tenure"], ["get", "Tenure"], ["get", "ownership"], ["get", "status"], ""]]]]];
  const BLOCK_LABEL = ["to-string", ["coalesce", ["get", "member_number"], ["get", "MemberNo"], ["get", "name"], ""]];
  // Regional zoom: nothing of the blocks (the group's outline says where it is). From z11, when blocks can be told apart, hairline
  // outlines and a very faint fill; a leased block dashed from z13; labels (the member number, or the name the group may show)
  // from z13.5; a block under the pointer a little stronger. The catchment outline the group keeps is a plain hairline.
  function quietLayer(l, sid, kind, describe) {
    const lk = quiet.look(), ids = [];
    if (!quiet.layers.includes(sid)) quiet.layers.push(sid);
    if (kind === "catchments") {
      ids.push(layer({ id: sid + "-fill", type: "fill", source: sid, paint: { "fill-color": lk.fill, "fill-opacity": 0 } }, describe));
      ids.push(layer({ id: sid + "-line", type: "line", source: sid, paint: { "line-color": lk.line, "line-width": 1, "line-opacity": 0.7 } }));
      return ids;
    }
    const from = (z, v) => ["step", ["zoom"], 0, z, v];
    ids.push(layer({ id: sid + "-fill", type: "fill", source: sid, paint: { "fill-color": lk.fill, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 10.5, 0, 11.5, 0.07, 14, 0.1] } }, describe));
    ids.push(layer({ id: sid + "-hl", type: "fill", source: sid, filter: ["==", ["literal", 1], 0], paint: { "fill-color": lk.fill, "fill-opacity": 0.26 } }));
    ids.push(layer({ id: sid + "-casing", type: "line", source: sid, layout: { "line-join": "round" }, paint: { "line-color": lk.casing, "line-width": 2.25, "line-opacity": from(11, 0.55) } }));
    ids.push(layer({ id: sid + "-line", type: "line", source: sid, layout: { "line-join": "round" },
      paint: { "line-color": lk.line, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.75, 15, 1], "line-opacity": ["step", ["zoom"], 0, 11, 0.95, 13, ["case", LEASED, 0, 0.95]] } }));
    ids.push(layer({ id: sid + "-lease", type: "line", source: sid, minzoom: 13, filter: LEASED, paint: { "line-color": lk.line, "line-width": 1, "line-dasharray": [3, 2] } }));
    if (map.getStyle()?.glyphs) ids.push(layer({ id: sid + "-label", type: "symbol", source: sid, minzoom: 13.5,
      layout: { "text-field": BLOCK_LABEL, "text-font": ["Open Sans Regular"], "text-size": 12, "text-padding": 6, "text-allow-overlap": false },
      paint: { "text-color": onDark() ? "#ffffff" : "#1d1d1f", "text-halo-color": onDark() ? "rgba(0, 0, 0, 0.6)" : "rgba(255, 255, 255, 0.9)", "text-halo-width": 1.2 } }));
    // the block under the pointer, a little stronger (one listener for the scene, put away with it)
    if (!quietOff) {
      const q = quiet;
      const onMove = (e) => {
        if (quiet !== q || !map) return;
        const fills = q.layers.map((s) => s + "-fill").filter((id) => map.getLayer(id) && map.getLayer(id.replace(/-fill$/, "-hl")));
        const hit = fills.length ? map.queryRenderedFeatures(e.point, { layers: fills })[0] : null;
        for (const s of q.layers) if (map.getLayer(s + "-hl")) {
          const mine = hit && hit.layer.id === s + "-fill", v = mine ? hit.properties.member_number ?? hit.properties.MemberNo ?? hit.properties.name : null;
          map.setFilter(s + "-hl", v != null ? ["==", BLOCK_LABEL, String(v)] : ["==", ["literal", 1], 0]);
        }
      };
      map.on("mousemove", onMove);
      quietOff = () => map?.off("mousemove", onMove);
    }
    return ids;
  }
  // the layers of one farm layer, by geometry: [polygonIds, lineIds, pointIds] filled in by pass
  function farmLayer(l, i, pass) {
    const sid = `fl-${i}`;
    const { look: st, record } = lookFor(l), z = zoomsOf(record);
    const describe = (f) => ({
      title: f.properties.name || f.properties.Name || f.properties.type || f.properties.label || l.name,
      layerName: l.name, qualifier: FP.farmModel.sourceLine(l), props: f.properties,
      resolution: FP.farmModel.resolutionLine(f.properties), note: l.id ? noteFor("layer:" + String(l.id).toLowerCase()) : null,
    });
    const ids = [];
    const lineOpacity = st.lineOpacity !== undefined ? { "line-opacity": st.lineOpacity } : {};   // only a record sets it
    const kind = K().kindOf(l.theme, l.geometry_type);
    // UI2: on a group's Overview its member blocks (and the member farms shown with them) and its own catchment outline are
    // drawn calm, in the group's hue, whatever their QGIS colours (never orange inside a thick blue line)
    if (quiet && l.geometry_type === "polygon" && (kind === "member_blocks" || kind === "catchments")) {
      if (pass === "polygon") ids.push(...quietLayer(l, sid, kind, describe));
      return ids;
    }
    if (pass === "polygon" && l.geometry_type === "polygon") {
      // land units are described by their place (code, name, area) and one plain source line, not the source file's fields
      ids.push(layer({ id: sid + "-fill", type: "fill", source: sid, ...z, paint: { "fill-color": st.fill, "fill-opacity": st.fillOpacity } },
        K().kindOf(l.theme, l.geometry_type) === "land_units" ? null : describe));
      ids.push(layer({ id: sid + "-line", type: "line", source: sid, ...z, paint: { "line-color": st.line, "line-width": st.lineWidth, ...lineOpacity } }));
    }
    if (pass === "line" && l.geometry_type === "line") {
      const paint = { "line-color": st.line, "line-width": st.lineWidth, ...lineOpacity };
      if (st.dash) paint["line-dasharray"] = st.dash;
      ids.push(layer({ id: sid + "-casing", type: "line", source: sid, ...z, paint: { "line-color": "#000", "line-opacity": 0.35, "line-width": plus(st.lineWidth, 2) } }));
      ids.push(layer({ id: sid + "-line", type: "line", source: sid, ...z, paint }, describe));
    }
    // photo points are camera markers (photoPins), not circles
    const photos = K().kindOf(l.theme, l.geometry_type) === "photos";
    if (pass === "point" && l.geometry_type === "point" && !photos) {
      ids.push(layer({ id: sid + "-pt", type: "circle", source: sid, ...z, paint: {
        "circle-color": st.fill, "circle-radius": atMost(st.radius, 9),
        "circle-stroke-color": st.line, "circle-stroke-width": 1.5 } }, describe));
    }
    // a record's labels, over everything the layer draws (last pass)
    if (pass === "point" && !photos) ids.push(...labelLayer(record, sid));
    return ids;
  }

  // A land unit drawn from a layer's own features (#411): its code and name where the file has them, else the layer's name.
  function unitTitle(p, l) {
    const code = p.code ?? p.Code ?? p.CODE, name = p.name ?? p.Name ?? p.NAME ?? p.label;
    return [code, name].filter((v) => v != null && String(v).trim()).join(" ").trim() || String(l.name || "Land unit");
  }
  // Land unit labels: a code (LU1) and a name. When two would touch, the name goes and the code stays, the largest
  // unit keeping its name first; zoom in and the names come back (FP.farmModel.unitNames decides, from screen boxes).
  // At national scale the farm is a speck and its labels would pile into one glyph: they wait until it is in frame.
  function landUnitLabels(units, extent) {
    const labels = [], own = [];
    for (const f of units.features) {
      const at = f.properties.label_at;
      if (!at) continue;
      const el = FP.el("div", { class: "lu-label" }, FP.el("b", {}, f.properties.code), FP.el("span", {}, f.properties.name));
      const marker = new maplibregl.Marker({ element: el }).setLngLat(at).addTo(map);
      markers.push(marker); own.push(marker);
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
    return own;
  }

  // ---- Photos (E3, #221): a small white camera on each photo point; a tap eases the map to it, turned to look the way
  // the camera did, with a view cone ahead of it, and opens its card beside the frame (wide) or as the sheet (narrow).
  const CAMERA = '<svg viewBox="0 0 20 16" width="18" height="15" aria-hidden="true" focusable="false"><path fill="currentColor" fill-rule="evenodd" ' +
    'd="M7 1h6l1.6 2.2H18a1.5 1.5 0 0 1 1.5 1.5v8.8A1.5 1.5 0 0 1 18 15H2a1.5 1.5 0 0 1-1.5-1.5V4.7A1.5 1.5 0 0 1 2 3.2h3.4zM10 5.3a3.7 3.7 0 1 0 0 7.4a3.7 3.7 0 1 0 0-7.4z"/></svg>';
  const NONE = { type: "FeatureCollection", features: [] };
  function photoPins(l, i) {
    const list = FP.photoModel.inTimeOrder(l.features?.features), own = [];
    list.forEach((f, k) => {
      const said = FP.photoModel.line(f.properties);
      const pin = FP.el("button", { type: "button", class: "photo-pin", title: said, "aria-label": said, onclick: () => showPhoto(i, k) });
      pin.innerHTML = CAMERA;
      // under 3D terrain a pin on a slope can read as behind the hill: it stays fully drawn (#229)
      const marker = new maplibregl.Marker({ element: pin, opacityWhenCovered: "1" }).setLngLat(f.geometry.coordinates).addTo(map);
      markers.push(marker); own.push(marker);
    });
    photoSets.set(i, { layer: l, list, markers: own });
    return own;
  }
  function showPhoto(i, k) {
    const set = photoSets.get(i), f = set?.list[k];
    if (!map || !f) return;
    featurePopup?.remove(); featurePopup = null;
    unfocus();   // the photo wins: a chosen line's mark, the dim round it and its tucked-away labels go (the host is told by fp-photo)
    const c = map.getContainer(), sheet = c.clientWidth < 640, model = FP.photoModel.card(f, set.layer, units, FP.farmModel.sourceLine);
    const focused = photo?.card.contains(document.activeElement) ? document.activeElement.getAttribute("aria-label") : null;
    photo?.card.remove();
    for (const s of photoSets.values()) s.markers.forEach((m, n) => m.getElement().classList.toggle("selected", s === set && n === k));
    // a host with sheets over the map (the farm space on a phone) folds them first: the photo takes that place
    c.dispatchEvent(new CustomEvent("fp-photo", { bubbles: true }));
    const card = FP.el("aside", { class: "photo-card" + (sheet ? " sheet" : ""), "aria-label": "Photo" }, FP.popup.photo(model,
      { at: k, of: set.list.length, earlier: () => showPhoto(i, k - 1), later: () => showPhoto(i, k + 1), close: dismissPhoto }));
    c.append(card);
    photo = { i, k, card };
    curatePins();   // a photo open: its layer's pins are shown, whatever the zoom
    if (focused) card.querySelector('[aria-label="' + focused + '"]:not([disabled])')?.focus();
    framePhoto(f, model.direction);
  }
  function framePhoto(f, deg, flattened = false) {
    const mine = ++photoMoves;   // first: a move this stops (the last photo's, or the farm's) is not checked as this one
    const P = FP.photoModel, at = f.geometry.coordinates, c = map.getContainer(), box = photo.card.getBoundingClientRect(), size = { width: c.clientWidth, height: c.clientHeight };
    const directed = Number.isFinite(deg), cam = P.camera(deg, { zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() });
    const sheet = photo.card.classList.contains("sheet"), pad = P.padding(size, box, sheet, directed);
    const shape = directed ? P.cone(at, deg, P.metresPerPixel(cam.zoom, at[1]) * Math.min(150, size.height * 0.3)) : null;
    map.getSource("photo-cone")?.setData(shape ? { type: "FeatureCollection", features: [{ type: "Feature", geometry: shape, properties: {} }] } : NONE);
    settling++; touched = false; framedWidth = window.innerWidth;   // a farm frame still settling gives way to the photo
    // #229: with the hills in 3D the camera is measured from the ground at the photo; where the map has no ground
    // there yet, the hills go flat while the photo is open (they come back when it closes)
    if (map.getTerrain?.() && stand(at) == null) holdTerrain();
    map.stop();
    // once at rest: the point, and the far edge of its cone, inside the frame (the cone in the room above the point)
    map.once("moveend", () => checkPhoto(mine, f, deg, at, shape, P.padding(size, box, sheet, false), size, flattened, 0));
    map.easeTo({ center: at, ...cam, offset: P.offset(pad), duration: reduced() ? 0 : 1400 });
  }
  let photoMoves = 0;
  function checkPhoto(mine, f, deg, at, shape, pad, size, flattened, tries) {
    if (mine !== photoMoves || !photo || !map || touched) return;   // another photo, closed, or the person has the camera
    const P = FP.photoModel, pt = (p) => { const q = map.project(p); return [q.x, q.y]; };
    // how much closer the ground looks than the zoom says: 20 m across the view at the point, against the zoom's scale
    const k = Math.PI / 180, b = (map.getBearing() + 90) * k, m = 20, side = [at[0] + (m * Math.sin(b)) / (111320 * Math.cos(at[1] * k)), at[1] + (m * Math.cos(b)) / 111320];
    const here = pt(at), across = Math.hypot(...pt(side).map((v, n) => v - here[n])), seen = across > 0 ? (P.metresPerPixel(map.getZoom(), at[1]) * across) / m : Infinity;
    const check = P.frameCheck(here, shape ? shape.coordinates[0].slice(1, -1).map(pt) : [], size, pad, seen);
    if (check.ok) return;
    if (check.lost || tries >= 2) {
      // the camera under terrain could not be made right: the hills go flat for this photo, and it is framed again
      if (!flattened && map.getTerrain?.()) { holdTerrain(); framePhoto(f, deg, true); }
      return;
    }
    const next = ++photoMoves;
    map.stop();
    map.once("moveend", () => checkPhoto(next, f, deg, at, shape, pad, size, flattened, tries + 1));
    map.easeTo({ zoom: map.getZoom() + check.zoom, around: at, duration: reduced() ? 0 : 300 });
  }
  // The person closes the photo (×, Escape): the map swings back to the farm's frame, flat and north up.
  function dismissPhoto() {
    if (drawn?.extent) reframe(drawn.extent); else closePhoto();
  }
  function closePhoto() {
    if (!photo) return;
    photo.card.remove(); photo = null; photoMoves++;
    curatePins();
    for (const s of photoSets.values()) for (const m of s.markers) m.getElement().classList.remove("selected");
    map?.getSource("photo-cone")?.setData(NONE);
    releaseTerrain();
  }

  // ---- Terrain (#229). MapLibre measures the camera's height from a reference height that an ease leaves where it
  // started (sea level, after the flight in from NZ), so every frame first sets it to the ground under what it frames.
  function stand(at) {
    const ground = groundAt(at);
    if (ground != null) map.jumpTo({ elevation: ground });
    return ground;
  }
  // The ground (as drawn) at a point, or null when terrain is off or no terrain tile there has loaded yet (MapLibre
  // then says 0, which is read as not known: a farm exactly at sea level is framed as if terrain were flat there).
  function groundAt(at) {
    if (!map?.getTerrain?.()) return null;
    const ground = map.queryTerrainElevation(at);
    return Number.isFinite(ground) && ground !== 0 ? ground : null;
  }
  // The fallback: the hills flattened while a photo is open, and back (as the person had them) when it closes.
  let heldTerrain = false;
  function holdTerrain() { if (!map?.getTerrain?.()) return; FP.basemaps.setTerrain(map, false); heldTerrain = !map.getTerrain(); }
  function releaseTerrain() { if (!heldTerrain) return; heldTerrain = false; if (map) FP.basemaps.setTerrain(map, true); }

  // The NZ -> farm zoom: a gentle eased flight a person can follow (farmModel.flight, about 3.6 s), or a jump when the
  // person asks their device for reduced motion. Shorter moves (a reframe, a chosen line) pass their own duration.
  let flightKey = null, settling = 0, framed = null, touched = false, resizing = 0, framedWidth = 0;   // framed: the extent last fitted; touched: the person has moved the map since
  const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wide = () => window.innerWidth > 800;
  function fit(bounds, padding, geom, motion = FP.farmModel.flight(reduced())) {
    const mid = [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];
    stand(mid);   // measured from the ground there (#229)
    map.fitBounds(bounds, { padding, ...(typeof motion === "number" ? { duration: motion } : motion), maxZoom: 17, pitch: 0 });   // flat: a photo's tilt never carries into a frame
    if (!map.isMoving()) stand(mid);   // a jump (reduced motion) measures the height itself, from tiles it may not have
    if (geom) { framed = geom; touched = false; framedWidth = window.innerWidth; settle(geom); }
    // a jump (reduced motion) has already ended its move: the farm frame's zoom is known now
    if (geom && geom === drawn?.extent && !map.isMoving() && !photo) { farmZoom = map.getZoom(); curatePins(); }
  }
  // The window (or the pane the app sits in) changed size: frame the farm again for the new map, unless the person has moved it.
  // (A phone keeps its frame when only its height changes: that is the keyboard coming up.)
  function onResize() {
    const mine = ++resizing, width = window.innerWidth;
    setTimeout(() => {
      if (mine !== resizing || !map || touched || (!wide() && width === framedWidth)) return;
      if (photo) { map.resize(); showPhoto(photo.i, photo.k); return; }   // an open photo is framed again, not the farm
      if (!framed) return;
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
  // #229: the ground under a frame becomes known as terrain tiles arrive (after the flight in from NZ, or as finer tiles
  // load). A frame or photo measured from a height that was a guess is framed again from the ground, once the camera
  // is at rest and the person has not moved it.
  let regroundQueued = false, regrounded = { key: null, n: 0 };
  function reground() {
    if (regroundQueued || !map?.getTerrain?.()) return;
    regroundQueued = true;
    setTimeout(() => {
      regroundQueued = false;
      if (!map?.getTerrain?.() || map.isMoving() || touched || (!photo && !framed)) return;
      const f = photo && photoSets.get(photo.i)?.list[photo.k], b = framed && bbox(framed);
      const at = f ? f.geometry.coordinates : [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2], ground = groundAt(at);
      if (ground == null || Math.abs(ground - map.getCameraTargetElevation()) <= 25) return;
      // twice at most for one frame: tiles that never finish loading must not keep the camera moving
      const key = f ? "photo " + photo.i + " " + photo.k : JSON.stringify(b);
      if (regrounded.key === key && regrounded.n >= 2) return;
      regrounded = { key, n: regrounded.key === key ? regrounded.n + 1 : 1 };
      if (f) showPhoto(photo.i, photo.k); else fit(b, FP.farmModel.framePadding(inset(), wide()), framed, reduced() ? 0 : 400);
    }, 250);
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
  // keepIfMoved (APP2b): a caller that is not the person (the water-quality line, opening or closing) leaves the camera where the
  // person has put it, as the re-ground and the settle do (#407): once the person has taken the camera, nothing takes it back.
  function reframe(geom, { keepIfMoved = false } = {}) {
    if (!map || !geom?.coordinates) return;
    if (keepIfMoved && touched) return;
    closePhoto();   // the farm is framed again: an open photo gives way
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
    closePhoto();   // a chosen line's frame wins over an open photo
    if (!place) { unfocus(); reframe(drawn.extent); return true; }
    map.getSource("focus")?.setData({ type: "FeatureCollection", features: hits });
    map.getSource("focus-dim")?.setData({ type: "Feature", properties: {}, geometry: FP.farmModel.dimAround(hits, drawn.extent) });
    dimmed = true;
    keepLabelsOff(hits.filter((f) => /LineString$/.test(f.geometry.type)));
    let [[w, s], [e, n]] = union(hits.map((f) => bbox(f.geometry)));
    const min = 0.002;   // a single bore is framed with its surroundings (about 200 m)
    if (e - w < min) [w, e] = [(w + e) / 2 - min / 2, (w + e) / 2 + min / 2];
    if (n - s < min) [s, n] = [(s + n) / 2 - min / 2, (s + n) / 2 + min / 2];
    flightKey = null;
    const c = map.getContainer(), pad = FP.farmModel.framePadding(inset(), wide());
    // a place that would fill most of the farm's own frame (LU1 and LU3, half the farm) keeps the farm frame, marked in it
    if (!FP.farmModel.framesPlace([[w, s], [e, n]], bbox(drawn.extent), { width: c.clientWidth, height: c.clientHeight }, pad)) {
      fit(bbox(drawn.extent), pad, drawn.extent, reduced() ? 0 : 900); return true;
    }
    fit([[w, s], [e, n]], FP.farmModel.framePadding(inset(), wide()), { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }, reduced() ? 0 : 900);
    return true;
  }
  // Every path that drops a chosen place goes through here: its mark, the dim round it, and any label tucked off it.
  let dimmed = false;
  function unfocus() {
    if (!map) return;
    map.getSource("focus")?.setData(NONE);
    map.getSource("focus-dim")?.setData(NONE);
    dimmed = false;
    keepLabelsOff([]);
  }
  // While a line (the creek) is chosen, no land unit label sits on it: a label it runs under is tucked away until it
  // is unchosen (screen boxes against the line as drawn, after every move).
  let offLine = null;
  function keepLabelsOff(lines) {
    if (offLine) { map.off("move", offLine); offLine = null; }
    for (const el of map.getContainer().querySelectorAll(".lu-label.on-line")) el.classList.remove("on-line");
    if (!lines.length) return;
    let queued = false;
    const place = () => {
      queued = false;
      if (!map) return;
      const r = map.getContainer().getBoundingClientRect(), at = (p) => { const q = map.project(p); return [q.x + r.left, q.y + r.top]; };
      const paths = lines.flatMap((f) => (f.geometry.type === "MultiLineString" ? f.geometry.coordinates : [f.geometry.coordinates]).map((path) => path.map(at)));
      const els = [...map.getContainer().querySelectorAll(".lu-label")];
      const hit = FP.farmModel.labelsOnLine(els.map((el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }), paths);
      els.forEach((el, n) => el.classList.toggle("on-line", hit[n]));
    };
    offLine = () => { if (!queued) { queued = true; requestAnimationFrame(place); } };
    map.on("move", offLine);
    offLine();
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
    clear(); flightKey = null; framed = null; removeSketch(); hasShown = true;
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

  // LP1: the home map (Places). PL2 (Josh, 13 Nov 2026): one level at a time. home.js passes the places of one level only (the top
  // level, or the places inside one group the person has stepped into); this draws them and nothing else. Each place is its own
  // (already lightened) outline once it is big enough on screen (item.pointZoom), with ONE mark at its middle: a group's round
  // marker (its logo, else its initials, ringed in its soft hue) with its name beside it; a farm a small ink dot with its name. UI2:
  // Felt's calm look on the plain map, thin outlines of soft hues over a faint casing, gentle fills.
  // Marks never touch each other, the panel, the card or the map's controls: one that would is dropped, the chosen place and then
  // the larger places first, until the map is zoomed in (homeModel.marksToShow); no dot is ever drawn without its name. A tap opens
  // what was tapped: a mark is its own target and wins; elsewhere the smallest outline under the tap (homeModel.pickHit).
  // padding: the map's edges the home panels cover. context: the outline of the group stepped into, drawn quietly around its
  // places (not a target, no mark). frame: the box to fit (the group stepped into), else every place drawn.
  // items: [{ id, kind: "farm" | "group" | "subgroup", name, geometry, bbox, pointZoom, hueKey, logo }] (hueKey: a sub-group's parent).
  let homeOff = null, homeItems = [], homeChosen = null;
  async function home(items, onSelect, padding, { context = null, frame = null } = {}) {
    const request = ++opening;
    if (!map) startBase = overviewBase();   // UI2b: a map made for Places opens on the plain ground
    init(); await loaded();
    if (request !== opening) return;
    clear(); flightKey = null; framed = null; removeSketch(); hasShown = true;
    overviewMode(true);
    map.resize();
    homeItems = items.filter((i) => i.geometry?.coordinates && i.bbox);
    homeChosen = null;
    const P = FP.mapPalette, H = FP.homeModel;
    const look = (i, sub) => P.look(P.hues(cssVar)[P.hueIndex(i.hueKey || i.id)], { sub, onDark: onDark() });
    const props = (i) => {
      const farm = i.kind === "farm", sub = i.kind === "subgroup", mark = P.farmMarker(onDark()), lk = look(i, sub);
      return { id: i.id, kind: farm ? "farm" : "group", sub, name: i.name, size: area(i.bbox), fill: farm ? mark.fill : lk.fill, line: farm ? mark.fill : lk.line,
        casing: lk.casing, fo: farm ? 0.12 : lk.fillOpacity, lw: farm ? 1.5 : lk.lineWidth };
    };
    const data = () => ({ type: "FeatureCollection", features: homeItems.map((i) => ({ type: "Feature", geometry: i.geometry, properties: props(i) })) });
    const contextData = () => ({ type: "FeatureCollection", features: context?.geometry ? [{ type: "Feature", geometry: context.geometry, properties: { line: look(context, false).line, casing: look(context, false).casing } }] : [] });
    source("home-shapes", data());
    source("home-context", contextData());
    const none = ["in", ["get", "id"], ["literal", []]];
    // the group stepped into: its own outline only, thin, under its places
    layer({ id: "home-context", type: "line", source: "home-context", layout: { "line-join": "round" }, paint: { "line-color": ["get", "line"], "line-width": 1.2, "line-opacity": 0.7 } });
    layer({ id: "home-fill", type: "fill", source: "home-shapes", filter: none, paint: { "fill-color": ["get", "fill"], "fill-opacity": ["get", "fo"] } });
    layer({ id: "home-chosen-fill", type: "fill", source: "home-shapes", filter: none, paint: { "fill-color": ["get", "fill"], "fill-opacity": 0.18 } });
    layer({ id: "home-casing", type: "line", source: "home-shapes", filter: none, layout: { "line-join": "round" }, paint: { "line-color": ["get", "casing"], "line-width": ["+", ["get", "lw"], 2] } });
    layer({ id: "home-line", type: "line", source: "home-shapes", filter: none, layout: { "line-join": "round" }, paint: { "line-color": ["get", "line"], "line-width": ["get", "lw"] } });
    layer({ id: "home-chosen", type: "line", source: "home-shapes", filter: none, layout: { "line-join": "round" }, paint: { "line-color": ["get", "line"], "line-width": 3 } });
    // the theme or the background changed: the same places in the colours for it
    paletteHooks.push(() => {
      if (!map?.getSource("home-shapes")) return;
      map.getSource("home-shapes").setData(data()); map.getSource("home-context")?.setData(contextData());
      for (const m of marks) m.node.style.setProperty("--ring", props(m.i).line);
    });
    // One mark per place, at its middle: a tap target of its own (44 px tall), so a tap on a name or marker is never taken by an
    // outline lying under it. The marks are for the pointer; the list and search beside the map are the keyboard's way in.
    const marks = [...homeItems].sort((a, b) => (a.kind === "farm") - (b.kind === "farm") || area(b.bbox) - area(a.bbox) || a.name.localeCompare(b.name)).map((i) => {
      const farm = i.kind === "farm";
      const badge = farm ? FP.el("i", { class: "hm-dot" }) : FP.el("span", { class: "hm-badge" }, i.logo ? FP.el("img", { src: i.logo, alt: "" }) : FP.icons?.monogram?.(i.name) || "");
      const face = FP.el("span", { class: "hm-face" }, badge, FP.el("span", { class: "hm-name" }, i.name));
      const node = FP.el("div", { class: "home-label", "data-kind": i.kind, "data-id": i.id, "aria-hidden": "true", style: "--ring: " + props(i).line }, face);
      node.addEventListener("click", (e) => { e.stopPropagation(); hover.remove(); onSelect(i.id); });
      const marker = new maplibregl.Marker({ element: node, anchor: "left", offset: [farm ? -6 : -14, 0] }).setLngLat(H.centre(i.bbox)).addTo(map);
      markers.push(marker);
      return { i, node, face };
    });
    // what the marks must keep clear of: the Places panel, the card, the back row and the map's own controls
    const avoid = () => [...document.querySelectorAll("#portfolio, #home-card, #home-level, #map .maplibregl-ctrl-top-right > *, #map .maplibregl-ctrl-bottom-left > *, #map .maplibregl-ctrl-bottom-right > *")]
      .filter((n) => !n.hidden && n.offsetParent !== null).map((n) => { const r = n.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    let queued = false;
    const place = () => {
      queued = false;
      if (!map) return;
      const f = map.getContainer().getBoundingClientRect(), z = map.getZoom();
      const order = [...marks].sort((a, b) => (b.i.id === homeChosen) - (a.i.id === homeChosen));
      for (const m of order) { m.node.classList.remove("off", "bare"); m.node.classList.toggle("chosen", homeChosen === m.i.id); m.node.classList.toggle("at-point", z < m.i.pointZoom); }
      const box = (n) => { const r = n.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
      const keep = H.marksToShow(order.map((m) => ({ box: box(m.face), bare: m.i.kind === "farm" ? null : box(m.face.firstChild) })),
        { avoid: avoid(), frame: { x: f.left, y: f.top, w: f.width, h: f.height } });
      order.forEach((m, n) => { m.node.classList.toggle("off", !keep[n]); m.node.classList.toggle("bare", keep[n] === "bare"); });
    };
    declutter = () => { if (!queued) { queued = true; requestAnimationFrame(place); } };
    for (const ev of ["move", "resize"]) map.on(ev, declutter);
    document.fonts?.ready.then(() => declutter?.());
    // outline once it is more than a speck (set again only when that changes); below that the place is its mark alone
    let split = null;
    const show = () => {
      if (!map?.getLayer("home-fill")) return;
      const z = map.getZoom(), shapes = homeItems.filter((i) => z >= i.pointZoom).map((i) => i.id), key = shapes.join();
      if (key === split) return;
      split = key;
      for (const id of ["home-fill", "home-casing", "home-line"]) map.setFilter(id, ["in", ["get", "id"], ["literal", shapes]]);
    };
    const hits = (point) => map.queryRenderedFeatures(point, { layers: ["home-fill", "home-line"].filter((id) => map.getLayer(id)) })
      .map((f) => ({ id: f.properties.id, name: f.properties.name, on: f.layer.id === "home-line" ? "line" : "fill", size: f.properties.size }));
    const hover = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: "home-hover", offset: 12 });
    const onMark = (e) => !!e.originalEvent?.target?.closest?.(".home-label");
    const onMove = (e) => {
      if (onMark(e)) { hover.remove(); return; }
      const all = hits(e.point), id = H.pickHit(all), f = all.find((h) => h.id === id);
      map.getCanvas().style.cursor = f ? "pointer" : "";
      if (!f) { hover.remove(); return; }
      hover.setLngLat(e.lngLat).setText(f.name).addTo(map);
    };
    const onOut = () => hover.remove();
    // (a tap on a mark is the mark's own: MapLibre still reports it as a map click, which is ignored here)
    const onTap = (e) => { if (onMark(e)) return; const id = H.pickHit(hits(e.point)); if (id) { hover.remove(); onSelect(id); } };
    map.on("zoom", show); map.on("moveend", show); map.on("mousemove", onMove); map.on("mouseout", onOut); map.on("click", onTap);
    homeOff = () => { map?.off("zoom", show); map?.off("moveend", show); map?.off("mousemove", onMove); map?.off("mouseout", onOut); map?.off("click", onTap); hover.remove(); homeItems = []; };
    const boxes = homeItems.map((i) => i.bbox);
    // all of them at once (never closer than a district, so one small farm still shows where it is), or New Zealand
    const to = frame || (boxes.length ? H.union(boxes) : [[166.3, -47.4], [178.6, -34.3]]);
    map.fitBounds(to, { padding, duration: 0, maxZoom: frame ? 13 : 10, pitch: 0 });
    show(); place();
  }
  // The chosen place: marked, and framed in the part of the map the home panels leave (nothing moves for a place with no shape).
  function homeChoose(id, padding) {
    if (!map?.getLayer("home-chosen")) return false;
    const only = ["in", ["get", "id"], ["literal", id ? [id] : []]];
    map.setFilter("home-chosen", only); map.setFilter("home-chosen-fill", only);
    homeChosen = id || null; declutter?.();
    const item = id && homeItems.find((i) => i.id === id);
    if (!item) return false;
    map.fitBounds(item.bbox, { padding, duration: reduced() ? 0 : 900, maxZoom: 15, pitch: 0 });
    return true;
  }

  const area = (b) => (b[1][0] - b[0][0]) * (b[1][1] - b[0][1]);
  function bbox(geom) {
    let w = 180, s = 90, e = -180, n = -90;
    const walk = (c) => (typeof c[0] === "number" ? ([w, s, e, n] = [Math.min(w, c[0]), Math.min(s, c[1]), Math.max(e, c[0]), Math.max(n, c[1])]) : c.forEach(walk));
    walk(geom.coordinates);
    return [[w, s], [e, n]];
  }

  // stylePreview (LK1): proposed style records to draw as if accepted, for a preview only; no other open passes it.
  async function open(farmId, supplied = null, { show = null, photo: wanted = null, stylePreview = null } = {}) {
    const request = ++opening;
    if (!map && supplied?.group && FP.mapPalette) startBase = overviewBase();   // UI2b: a group's Overview map opens on the plain ground
    init();
    const { data, error } = supplied ? { data: supplied, error: null } : await FP.sb.rpc("farm_map", { f: farmId });
    if (error) throw error;
    if (!data) return null;
    await loaded();
    await K()?.ready;   // LK4: the kind registry, read once per page (its fallback if it can't be)
    if (request !== opening) return null;
    clear(); framed = null;
    // UI2: a group's map (its Overview) is drawn calm, in the group's hue, on the plain map; a farm's map as it was
    quiet = data.group && FP.mapPalette ? quietLook(data) : null;
    overviewMode(!!quiet);
    looks = { styles: Array.isArray(data.styles) ? data.styles : [], preview: Array.isArray(stylePreview) ? stylePreview : null };
    // TIM1: a sketch of this farm's outline stays on screen until the extent layer is painted; anything else starts unseen
    const key = data.extent ? JSON.stringify(bbox(data.extent)) : null, kept = !!sketchNode && sketched === key;
    if (!kept) { removeSketch(); outlineAt = null; }
    const entries = drawnEntries = [];   // what the layer list shows: {key, name, sub, ids, on, markers, job}

    if (data.extent) {
      source("extent", { type: "Feature", geometry: data.extent, properties: {} });
      // E4: the farm mask (farmModel.farmMask): the world outside the boundary, dimmed once the flight lands (revealMask).
      // Under every layer this farm draws, so the boundary, the farm's layers and the reference layers around it (DM1: the
      // farm is a lens, never a clip) stay bright and clickable over the dimmed aerial; it is never a click target itself.
      const mask = FP.farmModel.farmMask(data.extent);
      if (mask) {
        source("farm-mask", { type: "Feature", geometry: mask, properties: {} });
        layer({ id: "farm-mask", type: "fill", source: "farm-mask", paint: { "fill-color": "#000000", "fill-opacity": 0,
          "fill-opacity-transition": { duration: FP.farmModel.maskFade(reduced()), delay: 0 } } });
      }
      masked = false;
    }
    // LK4: the bands every group is drawn into, by tier (the mask under them all)
    anchors();
    if (data.extent) {
      // the farm boundary: a boundary (tier 5), over the farm's titles
      const order = K().orderKey({ kind: "extent", owned: true, sort_order: 1e6 });
      entries.push({ key: "extent", kind: "extent", order, name: data.extent_label || "Farm boundary", sub: FP.ha(data.extent_ha), section: "farm", on: true,
        ids: drawGroup(order, () => quiet
          // UI2: a group's area: one soft outline of its hue over a faint casing, at every zoom
          ? [layer({ id: "extent-casing", type: "line", source: "extent", layout: { "line-join": "round" }, paint: { "line-color": quiet.look().casing, "line-width": 3.5 } }),
            layer({ id: "extent-line", type: "line", source: "extent", layout: { "line-join": "round" }, paint: { "line-color": quiet.look().line, "line-width": 1.5 } })]
          : [layer({ id: "extent-line", type: "line", source: "extent", paint: { "line-color": accent(), "line-width": 3 } })]) });
    }
    source("titles", data.titles);
    const titleOrder = K().orderKey({ kind: "titles", owned: true });
    const titleIds = drawGroup(titleOrder, () => [layer({ id: "titles-line", type: "line", source: "titles",
      paint: { "line-color": "#ffffff", "line-width": 1.5, "line-dasharray": [2, 1.5] } }),
      layer({ id: "titles-hit", type: "fill", source: "titles", paint: { "fill-color": "#fff", "fill-opacity": 0 } },
        (f) => ({ title: `Title ${f.properties.title_no}`, layerName: "Record of title", qualifier: f.properties.source ? `Source: ${f.properties.source}` : null,
                  props: { area_ha: f.properties.area_ha, estate: f.properties.estate } }))]);
    const titleHa = data.titles.features.reduce((a, f) => a + (Number(f.properties.area_ha) || 0), 0);
    entries.push({ key: "titles", kind: "titles", order: titleOrder, name: "Titles", sub: titleHa ? FP.ha(titleHa) : null, section: "farm", on: true, ids: titleIds });

    data.layers.forEach((l, i) => source(`fl-${i}`, l.features));
    source("land-units", data.land_units);
    units = data.land_units;
    const layerIds = data.layers.map(() => []);
    let registerRow = null;   // the land-units row that carries the register's labels (the first land-units layer)
    // LK4: a working or annotation layer (map_layers.role, or the annotation kind) is never drawn by default and never listed;
    // every other layer is drawn as one group at its kind's tier
    data.layers.forEach((l, i) => { if (shownLayer(l)) layerIds[i].push(...drawGroup(layerOrder(l, i), () => ["polygon", "line", "point"].flatMap((pass) => farmLayer(l, i, pass)))); });
    data.layers.forEach((l, i) => {
      if (!shownLayer(l)) return;
      const kind = K().kindOf(l.theme, l.geometry_type);
      // one plain name; where the layer came from is in each feature's popup, and how many features it holds is not for the reader
      const e = { key: l.theme, kind, theme: l.theme, geometry: l.geometry_type, order: layerOrder(l, i), name: FP.farmModel.layerName(l), sub: null, section: "farm", ids: layerIds[i], job: l.job || null,
        // PERF3b: which layer it is (a group's deferred layer is read by its id, its features set on source fl-<i>)
        layerId: l.id ?? null, layerIndex: i, ...(l.deferred === true ? { deferred: true, count: l.feature_count ?? null } : {}),
        ...(l.truncated === true ? { truncated: true, count: l.feature_count ?? null } : {}) };
      // LK1: the sentence the Layers list shows under the name, when the layer's record (or its theme's) has one
      const rec = FP.layerStyle ? lookFor(l).record : null, purpose = rec ? FP.layerStyle.purpose(rec) : null;
      if (purpose) e.purpose = purpose;
      if (kind === "land_units") {
        // #411: a scene may hold more than one land-units layer (HDLG's group map holds two). The register's land units
        // (data.land_units: a farm's own, with their codes and label points) are labelled and made clickable once, on the
        // first such layer's row. Every other land-units layer, and each one when the scene has no register (a group's map),
        // answers a click from its own features, with a hit layer of its own (one id per layer: the second used to collide).
        const register = !registerRow && count(data.land_units) > 0;
        // only the labels: a photo pin made earlier is the Photos layer's, never the land units' (pins showed with Photos off)
        if (!registerRow) { e.markers = landUnitLabels(data.land_units, data.extent); registerRow = e; }
        const id = register ? "land-units-hit" : `fl-${i}-units-hit`, title = register ? (p) => `${p.code} ${p.name || ""}`.trim() : (p) => unitTitle(p, l);
        unitHits.add(id);
        e.ids.push(drawGroup(e.order, () => layer({ id, type: "fill", source: register ? "land-units" : `fl-${i}`, paint: { "fill-color": "#000", "fill-opacity": 0 } },
          (f) => ({ title: title(f.properties), qualifier: FP.farmModel.sourceLine(l), props: { area_ha: f.properties.area_ha } }))));
      }
      // DM2: a farm's own waterways layer the shared network has set aside has nothing left to draw: not listed (it is
      // kept, and named under the network's `replaces`); Rivers below is the waterways layer
      // CAP1b: a deferred layer has no features here yet (it is read for the map in view): listed as it is, with no pins or
      // labels of its own made from features it doesn't have
      if (l.deferred === true) { entries.push(e); return; }
      if (kind === "waterways" && !count(l.features)) return;
      if (kind === "photos") { e.markers = photoPins(l, i); e.photoLayer = i; photoEntries.push(e); }
      if (kind === "actions") {
        e.markers = [];
        for (const f of l.features?.features || []) if (f.geometry?.type === "Point" && f.properties.map_code) {
          const label = FP.el("div", { class: "action-label" }, f.properties.map_code);
          const marker = new maplibregl.Marker({ element: label }).setLngLat(f.geometry.coordinates).addTo(map);
          markers.push(marker); e.markers.push(marker);
        }
      }
      entries.push(e);
    });

    // the open photo's view cone: a white wedge (no fill box), over the farm's layers
    source("photo-cone", NONE);
    layer({ id: "photo-cone-fill", type: "fill", source: "photo-cone", paint: { "fill-color": "#ffffff", "fill-opacity": 0.16 } });
    layer({ id: "photo-cone-casing", type: "line", source: "photo-cone", paint: { "line-color": "#000", "line-opacity": 0.35, "line-width": 3.5 } });
    layer({ id: "photo-cone-line", type: "line", source: "photo-cone", paint: { "line-color": "#ffffff", "line-width": 1.5 } });

    // Reference layers (referenceLayers): those the payload carries (a group's map, or a database before PERF1a); a
    // farm's sources join later, one at a time (addReference).
    refDrawn = []; refAdded = 0;
    for (const [i, r] of data.reference.entries()) { const order = refOrder(r, data.sources); entries.push({ ...drawGroup(order, () => referenceLayers(r, `ref-${i}`, r.key || "reference-" + i)), order }); }

    // Rivers (DM2): the shared waterways layer, merged by name and labelled once per run, read for the part of the map in
    // view as the person pans (waterways_in_view), not clipped to the farm. Labels need the basemap's glyphs (none in the demo).
    if (!FP.demo?.active) {
      source("rivers", NONE);
      // PROV1: the shared waterways layer is drawn from two sources (the river network and the Topo50 centrelines)
      const describe = (f) => ({ ...FP.farmModel.riverPopup(f.properties), provenance: RIVER_SOURCES.map(([key, name]) => FP.provenance?.lineFor(drawn?.sources, key, { name })).filter(Boolean) });
      const order = K().orderKey({ kind: "waterways", owned: false });
      const ids = drawGroup(order, () => FP.farmModel.riverLayers("rivers", { labels: !!map.getStyle()?.glyphs }).map((spec) => layer(spec, spec.type === "line" && /-line$/.test(spec.id) ? describe : null)));
      rivers = { key: "rivers", kind: "waterways", order, geometry: "line", name: "Rivers", sub: null, section: "reference", ids, rivers: true, read: null, asked: 0 };
      entries.push(rivers);
    }

    // What an answer is about, when one of its lines is chosen (focus, #224): the rest of the farm dims, and the chosen
    // place is drawn over everything, bright: areas lit (a faint white wash: the dim around them does the work) and outlined in white, a line (the creek) wide and light.
    const AREAS = ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]], LINES = ["in", ["geometry-type"], ["literal", ["LineString", "MultiLineString"]]];
    source("focus-dim", NONE);
    layer({ id: "focus-dim", type: "fill", source: "focus-dim", paint: { "fill-color": "#000000", "fill-opacity": 0.45 } });
    source("focus", { type: "FeatureCollection", features: [] });
    layer({ id: "focus-fill", type: "fill", source: "focus", filter: AREAS, paint: { "fill-color": "#ffffff", "fill-opacity": 0.08 } });
    layer({ id: "focus-casing", type: "line", source: "focus", filter: ["any", AREAS, LINES], paint: { "line-color": "#000000", "line-opacity": 0.5, "line-width": ["case", LINES, 9, 5] } });
    layer({ id: "focus-line", type: "line", source: "focus", filter: AREAS, paint: { "line-color": "#ffffff", "line-width": 2.5 } });
    layer({ id: "focus-water", type: "line", source: "focus", filter: LINES, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#bfe8ff", "line-width": 5 } });
    layer({ id: "focus-point", type: "circle", source: "focus", filter: ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]], paint: { "circle-color": "#ffffff", "circle-radius": 8, "circle-stroke-color": "#000000", "circle-stroke-width": 2 } });
    drawn = data;

    // what's on when the farm opens: the registry's opening view (config.js farmView.view, "quiet": the boundary and photos)
    // and every kind whose default rule has it on (LK4); the rest is a tick away (or the block's show option, when its host chose)
    const defaultOn = show ? new Set(show) : null, openingKinds = K().kindsOn([FP_CONFIG.farmView?.view || "quiet"]);
    const isOn = (e) => (defaultOn ? defaultOn.has(e.key) || (e.section === "reference" && defaultOn.has("reference")) : openingKinds.has(e.kind));
    // a photo asked for by the host is on show, with its layer
    const asked = wanted == null ? null : [...photoSets].map(([i, s]) => [i, s.list.findIndex((f) => String(f.id) === String(wanted))]).find(([, k]) => k >= 0);
    for (const e of entries) setVisible(e, isOn(e) || (!!asked && e.photoLayer === asked[0]));

    if (data.extent) {
      map.resize();
      const b = bbox(data.extent);
      // The portfolio may already have started this zoom; it is kept unless a phone sheet covers part of the map.
      const sheet = inset();
      // TIM1: framed by the sketch already; a person who moved the camera since keeps it (no settle back to the frame)
      if (kept) { flightKey = null; framed = data.extent; framedWidth = window.innerWidth; if (!touched) settle(data.extent); }
      // APP2: the same for the flight the portfolio started (zoomTo -> fit, which cleared `touched` as it began): a Zoom in, a drag
      // or the wheel pressed during it is the person's, so `touched` is kept and no settle or re-ground takes the camera back
      else if (flightKey === JSON.stringify(b) && !sheet) { flightKey = null; framed = data.extent; framedWidth = window.innerWidth; if (!touched) settle(data.extent); }
      else { flightKey = null; fit(b, FP.farmModel.framePadding(sheet, wide()), data.extent); }
    }
    if (data.extent) revealMask(request);
    if (data.extent) painted("extent", request).then((at) => { removeSketch(); outlineSeen(at); });
    hasShown = true;
    if (asked) showPhoto(...asked);
    return { farm: data.farm, extentHa: data.extent_ha, entries };
  }

  // Once the fly-in has landed (or at once, after a jump), the mask fades in: 0 -> 0.3 over farmModel.maskFade.
  let masked = false;
  function revealMask(request) {
    const show = () => {
      if (request !== opening || !map?.getLayer("farm-mask")) return;
      map.setPaintProperty("farm-mask", "fill-opacity", FP.farmModel.MASK_OPACITY); masked = true;
    };
    if (map.isMoving()) map.once("moveend", show); else show();
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
    const order = K().orderKey({ kind: "actions", owned: true });
    const ids = drawGroup(order, () => [
      layer({ id: "action-programme-lines", source: "action-programme", type: "line", paint: { "line-color": accent(), "line-width": 3 }, filter: ["!=", ["geometry-type"], "Point"] }, describe),
      layer({ id: "action-programme-points", source: "action-programme", type: "circle", paint: { "circle-color": accent(), "circle-radius": 6, "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 }, filter: ["==", ["geometry-type"], "Point"] }, describe),
    ]);
    const actionMarkers = [];
    for (const { at, codes } of groups.values()) {
      const label = FP.el("div", { class: "action-label" }, codes.slice(0, 3).join(", ") + (codes.length > 3 ? " +" + (codes.length - 3) : ""));
      const marker = new maplibregl.Marker({ element: label }).setLngLat(at).addTo(map);
      markers.push(marker); actionMarkers.push(marker);
    }
    return { key: "actions", kind: "actions", order, name: "Actions", ids, on: true, markers: actionMarkers, sub: null, section: "farm" };
  }

  function setVisible(entry, on) {
    entry.on = on;
    if (!on && photo && entry.photoLayer === photo.i) closePhoto();
    for (const id of entry.ids) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    for (const id of entry.past?.ids || []) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on && entry.past.on ? "visible" : "none");
    if (entry.photoLayer != null) { curatePins(); return; }
    if (entry.rivers && on) readRivers();
    for (const m of entry.markers || []) m.getElement().style.display = on ? "" : "none";
    if (entry.markers?.length && declutter) declutter();
  }
  // PERF3b: a deferred layer's features, read for the map in view (an empty collection clears it). Its row keeps its switch.
  // CAP1b: also a farm's reference source read for the map in view (its entry came truncated): the source its row's layers
  // draw from, with consents marked current or past as referenceLayers marks them.
  function layerData(entry, features) {
    const src = entry?.layerIndex != null && map?.getSource("fl-" + entry.layerIndex);
    const target = src || (entry?.section === "reference" && !entry.rivers && entry.ids?.length ? map?.getSource(map.getLayer(entry.ids[0])?.source || "") : null);
    if (!target) return false;
    let data = features?.features ? features : NONE;
    if (!src && entry.past) data = { ...data, features: data.features.map((f) => ({ ...f, properties: { ...f.properties, fp_past: FP.farmModel.pastConsent(f.properties) } })) };
    if (src) { sourceData.set("fl-" + entry.layerIndex, data); data = withEdits("fl-" + entry.layerIndex, data); }
    target.setData(data);
    return true;
  }
  // What is in view: its bounds ([[w, s], [e, n]]) and zoom; null before there is a map.
  function view() {
    if (!map) return null;
    const b = map.getBounds();
    return { bounds: [[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]], zoom: map.getZoom() };
  }
  // fn() each time the map comes to rest; returns the way to stop.
  function onMoveEnd(fn) {
    if (!map) return () => {};
    const m = map, handler = () => fn();
    m.on("moveend", handler);
    return () => m.off("moveend", handler);
  }
  // Photo pins by FP.photoModel.pinsShown: hidden at the farm's frame, shown once zoomed in, always while a photo is open.
  function curatePins() {
    if (!map) return;
    for (const e of photoEntries) {
      const shown = FP.photoModel.pinsShown({ on: e.on, open: !!photo && photo.i === e.photoLayer, zoom: map.getZoom(), farmZoom });
      for (const m of e.markers || []) m.getElement().style.display = shown ? "" : "none";
    }
  }

  // A row's second switch (Consents: "Past consents") adds what the first leaves out; it shows only while the row is on.
  function setPast(entry, on) {
    if (!entry.past) return;
    entry.past.on = on;
    for (const id of entry.past.ids) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", entry.on && on ? "visible" : "none");
  }

  // FB1: while a flow has the map (choosing parcels, drawing a boundary) its taps are its own: no feature popups.
  let captured = null;
  // GE1b: a host's tools for a tapped feature (the shape editor's Edit shape, or why it can't be): tools(hit, {lngLat, close})
  // returns a node to add under the popup's details, or null. No host tools, or null: the popup is exactly as before.
  let tools = null;
  // What a tapped feature is to the shape editor: a farm or group layer's feature ({layer, layerIndex, id}), the farm's register
  // land units ({units}), a shared reference source ({reference}), or nothing it is about (titles, actions, rivers).
  function editTarget(f) {
    const id = f?.layer?.id || "", src = f?.layer?.source || "", m = /^fl-(\d+)$/.exec(src);
    if (id === "land-units-hit") return { units: true };
    if (m && drawn?.layers?.[Number(m[1])]) return { layer: drawn.layers[Number(m[1])], layerIndex: Number(m[1]), id: f.id ?? null };
    if (refKeys.has(src)) return { reference: refKeys.get(src) };
    return null;
  }
  function onClick(e) {
    if (captured) { captured(e); return; }
    if (e.originalEvent?.target?.closest?.(".photo-pin")) return;   // a camera marker opens its photo itself
    const ids = [...interactive.keys()].filter((id) => map.getLayer(id));
    const hits = map.queryRenderedFeatures(e.point, { layers: ids });
    if (!hits.length) return;
    // points over lines over areas; titles last
    // (land units are under every other area: a planting tapped inside a land unit is the planting)
    const rank = (h) => (h.layer.type === "circle" ? 0 : h.layer.type === "line" ? 1 : h.layer.id === "titles-hit" ? 4 : unitHits.has(h.layer.id) ? 3 : 2);
    hits.sort((a, b) => rank(a) - rank(b));
    const f = hits[0];
    const props = {};
    for (const [k, v] of Object.entries(f.properties)) {
      try { props[k] = typeof v === "string" && /^[[{]/.test(v) ? JSON.parse(v) : v; } catch { props[k] = v; }
    }
    const hit = interactive.get(f.layer.id)({ ...f, properties: props });
    if (props.authorisations && !hit.permits) hit.permits = props.authorisations;
    closePhoto();
    const content = FP.popup.content(hit);
    let popup = null;
    // (and what else is under the tap that a layer holds: a member block under the member farms' outline can still be edited)
    const extra = tools ? tools({ ...hit, edit: editTarget(f), under: hits.slice(1).map(editTarget).filter((t) => t?.layer) }, { lngLat: e.lngLat.toArray(), close: () => popup?.remove() }) : null;
    if (extra) content.append(extra);
    popup = new maplibregl.Popup({ maxWidth: Math.min(320, map.getContainer().clientWidth - 24) + "px" }).setLngLat(e.lngLat).setDOMContent(content).addTo(map);
    featurePopup = popup; popup.on("close", () => { if (featurePopup === popup) featurePopup = null; });
    keepInside(popup);
    // Opening the layer's Advisor note (LN1) makes the popup taller: keep it inside the map again.
    popup.getElement().addEventListener("toggle", () => keepInside(popup), true);
  }

  // UI1: a feature popup belongs to the view it was opened in: the farm space closes it when the view changes (Ask, Create,
  // Documents) or a sheet opens over it.
  function closePopup() { featurePopup?.remove(); featurePopup = null; }
  // Resolves once the camera has come to rest with nothing queued to move it again: the 3.6 s fly-in has landed, the frame
  // has settled and been re-grounded. An explicit signal for checks that measure the frame (moveend and the queued re-ground,
  // not a longer sleep); it also resolves if the map is removed.
  function atRest() {
    return new Promise((resolve) => {
      let quiet = 0;
      const look = () => {
        if (!map) return resolve();
        quiet = map.isMoving() || regroundQueued ? 0 : quiet + 1;
        if (quiet >= 3) return resolve();   // three looks in a row, the last after the re-ground's own 250 ms delay
        setTimeout(look, 120);
      };
      look();
    });
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
    opening++; resizing++; framed = null; photo?.card.remove(); photo = null; heldTerrain = false; photoSets.clear(); window.removeEventListener("resize", onResize); scheme?.removeEventListener("change", syncPalette); observer?.disconnect();
    for (const m of markers) m.remove();
    removeSketch();
    markers = []; added = []; interactive.clear(); map.remove(); map = null; ready = null; styleAt = null;
  }
  return { open, portfolio, zoomTo, reframe, focus, project, camera: () => map && { zoom: map.getZoom(), center: map.getCenter().toArray(), pitch: map.getPitch(), bearing: map.getBearing(), moving: map.isMoving(), terrain: !!map.getTerrain?.(), elevation: map.getCameraTargetElevation?.() ?? 0, dimmed, labelsOff: map.getContainer().querySelectorAll(".lu-label.on-line").length, masked, mask: map.getLayer("farm-mask") ? map.getPaintProperty("farm-mask", "fill-opacity") : null }, setVisible, setPast, addControl: (control, position) => init().addControl(control, position), whenIdle, basemap: (k) => { farmBase = base = k; markBg(); return FP.basemaps.pick(init(), k); }, terrain: (on) => { heldTerrain = false; return FP.basemaps.setTerrain(init(), on); }, frame: (geom) => { if (map && geom?.coordinates) map.fitBounds(bbox(geom), { padding: 55, duration: 400 }); }, addActions,
    // FB1: the live MapLibre map, for a flow that draws its own layers over the farm (add-block.js); it removes them itself.
    glMap: () => init(), loaded: () => (init(), ready), capture: (fn) => { captured = typeof fn === "function" ? fn : null; if (captured) featurePopup?.remove(); },
    // and the farm mask lifted while the flow shows the land around the farm (put back as it was when it ends)
    unmask: (off) => { if (map?.getLayer("farm-mask")) map.setPaintProperty("farm-mask", "fill-opacity", off ? 0 : masked ? FP.farmModel.MASK_OPACITY : 0); },
    resize: () => map && map.resize(), closePopup, atRest, closePhoto, dismissPhoto, photoOpen: () => (photo ? { layer: photo.i, at: photo.k } : null), remove,
    // PERF3b: a group's deferred layer drawn for the map in view
    layerData, view, onMoveEnd,
    // LP1: the home map of every place the person can see, and the one chosen on it
    home, homeChoose,
    // LK2: looks that came after the scene was drawn, applied to it; LK4: a second context fill drawn as outline and hatch
    restyle, setStacked,
    // PERF1b: a reference source read after the farm was drawn joins the scene; Rivers read ahead for the map in view.
    // TIM1 (#410): the outline at once on a fresh map; when the style loaded and the outline was first on screen (route timing)
    sketch, unsketch: removeSketch, outlineShown, styleLoadedAt: () => styleAt,
    // GE1b: the shape editor's hooks: a host's popup tools, a feature as its layer's source holds it, a saved shape drawn in
    // place (kept over later viewport reads until the scene is drawn again), and the scene drawn (its boundary, to snap to)
    featureTools: (fn) => { tools = typeof fn === "function" ? fn : null; }, featureData, patchFeature, scene: () => drawn,
    addReference, readRiversAhead: () => readRivers(true) };
  }

  return { block, state, engine };
});

