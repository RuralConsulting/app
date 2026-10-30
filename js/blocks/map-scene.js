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
  let declutter = null;            // the label-collision handler for what is drawn (portfolio pins, or a farm's land unit labels)
  const photoSets = new Map();     // farm layer index -> { layer, list (its photos in time order), markers }
  let photo = null;                // the photo open on the map: { i, k, card }
  let units = null;                // the scene's land units (a photo's card says which one it sits in)
  let featurePopup = null;         // the feature popup open on the map, if any
  let drawn = null;                // the farm payload on the map now, for focus()
  let farmZoom = null;             // the zoom the farm's own frame settled at (photo pins show once zoomed in past it)
  const photoEntries = [];         // the Photos rows: their pins are drawn by curatePins, not by setVisible alone

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
        ["extent-line", "line-color"], ["action-programme-lines", "line-color"], ["action-programme-points", "circle-color"]]) {
        if (map.getLayer(id)) map.setPaintProperty(id, property, accent());
      }
    });
    scheme = window.matchMedia("(prefers-color-scheme: dark)"); scheme.addEventListener("change", syncPalette);
    observer = new MutationObserver(syncPalette); observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
    for (const ev of ["dragstart", "zoomstart", "rotatestart", "pitchstart"]) map.on(ev, (e) => { if (e.originalEvent) { settling++; touched = true; } });   // the person has taken the camera
    window.addEventListener("resize", onResize);
    map.on("click", onClick);
    map.on("moveend", reground);
    // the zoom the farm's own frame settled at, and the photo pins curated against it (FP.photoModel.pinsShown)
    map.on("moveend", () => { if (map && !touched && !photo && drawn?.extent && framed === drawn.extent && !map.isMoving()) farmZoom = map.getZoom(); curatePins(); });
    map.on("zoomend", curatePins);
    map.on("data", (e) => { if (e.sourceId && e.sourceId === map?.getTerrain?.()?.source) reground(); });
    map.on("mousemove", (e) => {
      const ids = [...interactive.keys()].filter((id) => map.getLayer(id));
      map.getCanvas().style.cursor = ids.length && map.queryRenderedFeatures(e.point, { layers: ids }).length ? "pointer" : "";
    });
    return map;
  }

  const loaded = () => ready;

  function clear() {
    if (photo) closePhoto();   // (and the hills come back if a photo had flattened them)
    photo?.card.remove(); photo = null; photoSets.clear(); units = null; featurePopup?.remove(); featurePopup = null;
    if (declutter) { for (const ev of ["move", "resize"]) map.off(ev, declutter); declutter = null; }
    if (offLine) { map.off("move", offLine); offLine = null; }
    for (const m of markers) m.remove();
    markers = [];
    for (const { kind, id } of [...added].reverse()) {
      if (kind === "layer" && map.getLayer(id)) map.removeLayer(id);
      if (kind === "source" && map.getSource(id)) map.removeSource(id);
    }
    added = [];
    interactive.clear();
    drawn = null; farmZoom = null; photoEntries.length = 0;
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
      resolution: FP.farmModel.resolutionLine(f.properties),
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
    // photo points are camera markers (photoPins), not circles
    if (pass === "point" && l.geometry_type === "point" && l.theme !== "photos") {
      ids.push(layer({ id: sid + "-pt", type: "circle", source: sid, paint: {
        "circle-color": st.fill, "circle-radius": Math.min(st.radius, 9),
        "circle-stroke-color": st.line, "circle-stroke-width": 1.5 } }, describe));
    }
    return ids;
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

  // The NZ -> farm zoom: a smooth fly, or a jump when the person asks their device for reduced motion.
  let flightKey = null, settling = 0, framed = null, touched = false, resizing = 0, framedWidth = 0;   // framed: the extent last fitted; touched: the person has moved the map since
  const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wide = () => window.innerWidth > 800;
  function fit(bounds, padding, geom, duration = reduced() ? 0 : 2600) {
    const mid = [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];
    stand(mid);   // measured from the ground there (#229)
    map.fitBounds(bounds, { padding, duration, maxZoom: 17, pitch: 0 });   // flat: a photo's tilt never carries into a frame
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
  function reframe(geom) {
    if (!map || !geom?.coordinates) return;
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

  async function open(farmId, supplied = null, { show = null, photo: wanted = null } = {}) {
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
    units = data.land_units;
    const layerIds = data.layers.map(() => []);
    for (const pass of ["polygon", "line", "point"]) {
      data.layers.forEach((l, i) => layerIds[i].push(...farmLayer(l, i, pass)));
    }
    data.layers.forEach((l, i) => {
      // one plain name; where the layer came from is in each feature's popup, and how many features it holds is not for the reader
      const e = { key: l.theme, name: FP.farmModel.layerName(l), sub: null, section: "farm", ids: layerIds[i], job: l.job || null };
      if (l.theme === "land_units") {
        // only the labels: a photo pin made earlier is the Photos layer's, never the land units' (pins showed with Photos off)
        e.markers = landUnitLabels(data.land_units, data.extent);
        e.ids.push(layer({ id: "land-units-hit", type: "fill", source: "land-units", paint: { "fill-color": "#000", "fill-opacity": 0 } },
          (f) => ({ title: `${f.properties.code} ${f.properties.name || ""}`.trim(), qualifier: FP.farmModel.sourceLine(l),
                    props: { area_ha: f.properties.area_ha } })));
      }
      if (l.theme === "photos") { e.markers = photoPins(l, i); e.photoLayer = i; photoEntries.push(e); }
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

    // the open photo's view cone: a white wedge (no fill box), over the farm's layers
    source("photo-cone", NONE);
    layer({ id: "photo-cone-fill", type: "fill", source: "photo-cone", paint: { "fill-color": "#ffffff", "fill-opacity": 0.16 } });
    layer({ id: "photo-cone-casing", type: "line", source: "photo-cone", paint: { "line-color": "#000", "line-opacity": 0.35, "line-width": 3.5 } });
    layer({ id: "photo-cone-line", type: "line", source: "photo-cone", paint: { "line-color": "#ffffff", "line-width": 1.5 } });

    // Reference layers, each drawn by its geometry (#243): lines as light blue lines on a dark casing, areas as a fill
    // and outline, points as circles; one describe per layer, so every popup says what it is and where it came from.
    // Consents: current ones only, until "Past consents" adds the rest (the row's own second switch).
    const AREA = ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]], LINE = ["in", ["geometry-type"], ["literal", ["LineString", "MultiLineString"]]],
      POINT = ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]];
    for (const [i, r] of data.reference.entries()) {
      const sid = `ref-${i}`, consents = r.theme === "consents" || r.key === "ecan-consents";
      const features = consents ? { ...r.features, features: (r.features?.features || []).map((f) => ({ ...f, properties: { ...f.properties, fp_past: FP.farmModel.pastConsent(f.properties) } })) } : r.features;
      source(sid, features);
      const describe = (f) => {
        const { fp_past, ...props } = f.properties;
        if (consents) return FP.farmModel.consentPopup(props, r, f.properties.on_farm ? "On the farm" : "Off the farm, linked to the farm's permit");
        const named = props.name || props.Name || props.NAME;
        return { title: named ? String(named) : `${r.theme === "wells" ? "Bore" : FP.farmModel.layerName(r)} ${props.external_id ?? ""}`.trim(), layerName: FP.farmModel.layerName(r),
          qualifier: props.on_farm ? "On the farm" : "Off the farm, linked to the farm's permit", props, permits: props.authorisations || [], attribution: r.attribution };
      };
      const ids = [
        layer({ id: sid + "-fill", type: "fill", source: sid, filter: AREA, paint: { "fill-color": "#bfe8ff", "fill-opacity": 0.25 } }, describe),
        layer({ id: sid + "-outline", type: "line", source: sid, filter: AREA, paint: { "line-color": "#bfe8ff", "line-width": 1.5 } }),
        layer({ id: sid + "-casing", type: "line", source: sid, filter: LINE, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#000000", "line-opacity": 0.5, "line-width": 5 } }),
        layer({ id: sid + "-line", type: "line", source: sid, filter: LINE, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#bfe8ff", "line-width": 2.5 } }, describe),
        layer({ id: sid + "-pt", type: "circle", source: sid, filter: consents ? ["all", POINT, ["!=", ["get", "fp_past"], true]] : POINT, paint: {
          "circle-color": "#1e88e5", "circle-radius": 7, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } }, describe),
      ];
      const past = consents ? [layer({ id: sid + "-past", type: "circle", source: sid, filter: ["all", POINT, ["==", ["get", "fp_past"], true]], paint: {
        "circle-color": "#78909c", "circle-radius": 6, "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5 } }, describe)] : null;
      entries.push({ key: r.key || "reference-" + i, name: FP.farmModel.layerName(r), sub: null, section: "reference", ids, ...(past ? { past: { ids: past, on: false } } : {}) });
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

    // what's on when the farm opens comes from config.js (farmView.defaultOn); the rest is a tick away
    // (or from the block's show option, when its host chose)
    const defaultOn = new Set(show || [...(FP_CONFIG.farmView?.defaultOn || []), ...(FP.demo?.active ? ["actions"] : [])]);
    // a photo asked for by the host is on show, with its layer
    const asked = wanted == null ? null : [...photoSets].map(([i, s]) => [i, s.list.findIndex((f) => String(f.id) === String(wanted))]).find(([, k]) => k >= 0);
    for (const e of entries) setVisible(e, defaultOn.has(e.key) || (e.section === "reference" && defaultOn.has("reference")) || (!!asked && e.photoLayer === asked[0]));

    if (data.extent) {
      map.resize();
      const b = bbox(data.extent);
      // The portfolio may already have started this zoom; it is kept unless a phone sheet covers part of the map.
      const sheet = inset();
      if (flightKey === JSON.stringify(b) && !sheet) { flightKey = null; framed = data.extent; touched = false; framedWidth = window.innerWidth; settle(data.extent); }
      else { flightKey = null; fit(b, FP.farmModel.framePadding(sheet, wide()), data.extent); }
    }
    if (asked) showPhoto(...asked);
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
    if (!on && photo && entry.photoLayer === photo.i) closePhoto();
    for (const id of entry.ids) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    for (const id of entry.past?.ids || []) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on && entry.past.on ? "visible" : "none");
    if (entry.photoLayer != null) { curatePins(); return; }
    for (const m of entry.markers || []) m.getElement().style.display = on ? "" : "none";
    if (entry.markers?.length && declutter) declutter();
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

  function onClick(e) {
    if (e.originalEvent?.target?.closest?.(".photo-pin")) return;   // a camera marker opens its photo itself
    const ids = [...interactive.keys()].filter((id) => map.getLayer(id));
    const hits = map.queryRenderedFeatures(e.point, { layers: ids });
    if (!hits.length) return;
    // points over lines over areas; titles last
    // (land units are under every other area: a planting tapped inside a land unit is the planting)
    const rank = (h) => (h.layer.type === "circle" ? 0 : h.layer.type === "line" ? 1 : h.layer.id === "titles-hit" ? 4 : h.layer.id === "land-units-hit" ? 3 : 2);
    hits.sort((a, b) => rank(a) - rank(b));
    const f = hits[0];
    const props = {};
    for (const [k, v] of Object.entries(f.properties)) {
      try { props[k] = typeof v === "string" && /^[[{]/.test(v) ? JSON.parse(v) : v; } catch { props[k] = v; }
    }
    const hit = interactive.get(f.layer.id)({ ...f, properties: props });
    if (props.authorisations && !hit.permits) hit.permits = props.authorisations;
    closePhoto();
    const popup = new maplibregl.Popup({ maxWidth: Math.min(320, map.getContainer().clientWidth - 24) + "px" }).setLngLat(e.lngLat).setDOMContent(FP.popup.content(hit)).addTo(map);
    featurePopup = popup; popup.on("close", () => { if (featurePopup === popup) featurePopup = null; });
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
    opening++; resizing++; framed = null; photo?.card.remove(); photo = null; heldTerrain = false; photoSets.clear(); window.removeEventListener("resize", onResize); scheme?.removeEventListener("change", syncPalette); observer?.disconnect();
    for (const m of markers) m.remove();
    markers = []; added = []; interactive.clear(); map.remove(); map = null; ready = null;
  }
  return { open, portfolio, zoomTo, reframe, focus, project, camera: () => map && { zoom: map.getZoom(), center: map.getCenter().toArray(), pitch: map.getPitch(), bearing: map.getBearing(), moving: map.isMoving(), terrain: !!map.getTerrain?.(), elevation: map.getCameraTargetElevation?.() ?? 0, dimmed, labelsOff: map.getContainer().querySelectorAll(".lu-label.on-line").length }, setVisible, setPast, addControl: (control, position) => init().addControl(control, position), whenIdle, basemap: (k) => FP.basemaps.pick(init(), k), terrain: (on) => { heldTerrain = false; return FP.basemaps.setTerrain(init(), on); }, frame: (geom) => { if (map && geom?.coordinates) map.fitBounds(bbox(geom), { padding: 55, duration: 400 }); }, addActions,
    resize: () => map && map.resize(), closePhoto, dismissPhoto, photoOpen: () => (photo ? { layer: photo.i, at: photo.k } : null), remove };
  }

  return { block, state, engine };
});

