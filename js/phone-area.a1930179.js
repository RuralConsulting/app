// PH1: a group's Home on a phone (the owner, 13 Nov 2026: "simple load to area (group or subgroup), can quick locate to where I am
// (based on gps location), and then can either find local info (like a wq site to return to), or do an action from the plus symbol").
// A plain map of the group's area with almost nothing on it, one "Locate me" control (a dot and its accuracy ring at the phone's
// position), and below it one short list of what is near: the water quality sites the person may read, nearest first with the
// distance. Tapping a site shows it on the map and opens what Maps already shows for it (wq-sites.js's panel: its latest results,
// chart, band and trend). No layer switching. The + (add.js, capture-ring.js) floats above the list. The words are phone-model.js's.
//
// Reads: none new, and none wider. Each is one the app already makes, as the signed-in person (row-level security and the
// functions' own rules decide what comes back):
//   places (kind area)   the group's area, as Places reads it (home.js readShapes)
//   group_wq_sites       the group's sites, as Maps' water quality reads them (wq-sites.js), capped at phone-model READ_CAP rows
//   a site's results     only when the person opens one, through wq-sites.js's own reads (wq_site_latest, measurement_series, ...)
(function (root) {
  const FP = root.FP;
  const P = () => FP.phoneModel;
  const el = (...a) => FP.el(...a);
  const NZ = [[166.3, -47.4], [178.6, -34.3]];
  let shown = null;

  const phone = () => !!root.matchMedia?.(P().PHONE).matches;
  // A circle of `m` metres about a fix, as a polygon (the accuracy ring)
  function ring(f, m, steps = 48) {
    const out = [], lat = (f.lat * Math.PI) / 180, dy = m / 111320, dx = m / (111320 * Math.max(Math.cos(lat), 0.01));
    for (let i = 0; i <= steps; i++) { const a = (i / steps) * 2 * Math.PI; out.push([f.lon + dx * Math.cos(a), f.lat + dy * Math.sin(a)]); }
    return out;
  }
  const meData = (f) => ({ type: "FeatureCollection", features: f ? [
    ...(f.accuracy ? [{ type: "Feature", properties: { kind: "ring" }, geometry: { type: "Polygon", coordinates: [ring(f, Math.max(f.accuracy, 5))] } }] : []),
    { type: "Feature", properties: { kind: "dot" }, geometry: { type: "Point", coordinates: [f.lon, f.lat] } }] : [] });

  // opts: { group: { id, name }, sb, home: Home's options (place-home.js) for its search }. Returns the Home element; the map is made
  // once it is on the page.
  function view({ group, sb = FP.sb, home = null }) {
    close();
    const me = { alive: true, map: null, overlay: null, stop: null, wq: null, sites: null, rows: null, located: null, centre: null, timer: null };
    shown = me;
    const live = () => me.alive && shown === me;
    const mapBox = el("div", { class: "pa-map", id: "pa-map", role: "region", "aria-label": "Map of " + group.name });
    const locate = el("button", { type: "button", class: "pa-locate", id: "pa-locate", "aria-label": "Locate me", title: "Locate me" }, FP.icon("locate", 22));
    const stage = el("div", { class: "pa-stage" }, mapBox, locate);
    const line = el("p", { class: "pa-line", id: "pa-line" });
    const say = el("div", { class: "pa-say", id: "pa-say", role: "status", "aria-live": "polite" });
    const set = el("ul", { class: "pa-set", id: "pa-near", "aria-label": "Near you" });
    // Home's search first (review of #535, 2; docs/PRODUCT.md: on a phone search comes first): the compact one MC1's overview uses,
    // one box across the files, events, maps, sub-groups and (for People's roles) members and people; while it is used, its results
    // take the sheet
    const search = home && FP.placeHome ? FP.placeHome.view({ ...home, compact: true }) : null;
    const sheet = el("section", { class: "pa-sheet", "aria-labelledby": "pa-near-title" }, ...(search ? [search] : []), el("h2", { id: "pa-near-title" }, "Near you"), line, say, set);
    const wrap = el("section", { class: "pa", "data-view": "home", "aria-label": "Home" }, stage, sheet);
    me.wrap = wrap;

    // ---- the list -------------------------------------------------------------------------------------------------------------
    const row = (s) => el("li", {}, el("button", { type: "button", class: "pa-row", "data-site": String(s.id), onclick: () => openSite(s) },
      el("span", { class: "pa-dot", "aria-hidden": "true" }, FP.icon("water", 18)),
      el("span", { class: "pa-name" }, s.name), el("span", { class: "pa-far" }, s.words)));
    function draw() {
      if (!live()) return;
      if (me.sites === null) { line.textContent = "Looking for what is near…"; set.replaceChildren(); set.hidden = true; return; }
      if (me.sites === false) { line.textContent = P().SITES_FAILED; set.replaceChildren(); set.hidden = true; return; }
      const from = me.located || me.centre;
      const near = P().nearby(me.sites, from);
      line.textContent = near.length ? P().nearbyLine({ located: !!me.located, fix: me.located, count: near.length }) : P().NO_SITES;
      set.replaceChildren(...near.map(row));
      set.hidden = !near.length;
    }
    function problem(p) {
      if (!p) { say.replaceChildren(); return; }
      say.replaceChildren(el("p", { class: "pa-say-text" }, p.text + " " + p.how),
        el("div", { class: "pa-set pa-set-one" }, el("button", { type: "button", class: "pa-row", id: "pa-retry", onclick: () => find(true) },
          el("span", { class: "pa-dot", "aria-hidden": "true" }, FP.icon("locate", 18)), el("span", { class: "pa-name" }, "Try again"))));
    }

    // ---- where the person is ------------------------------------------------------------------------------------------------------
    function showMe(f, fly) {
      if (!live() || !f) return;
      me.located = f;
      const src = me.map?.getSource?.("pa-me");
      if (src) src.setData(meData(f));
      if (fly && me.map) me.map.easeTo({ center: [f.lon, f.lat], zoom: Math.max(me.map.getZoom(), 14), padding: { top: 40, bottom: 40, left: 40, right: 40 }, duration: root.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 600 });
      locate.setAttribute("aria-pressed", "true");
      draw();
    }
    async function find(fly) {
      locate.disabled = true; locate.classList.add("pa-busy"); problem(null);
      const got = await FP.locate.get({ maxAge: 5000 });
      if (!live()) return;
      locate.disabled = false; locate.classList.remove("pa-busy");
      if (!got.ok) { locate.setAttribute("aria-pressed", "false"); problem(got.problem); return; }
      showMe(got.fix, fly);
      if (!me.stop) me.stop = FP.locate.watch((f) => showMe(f, false));
    }
    locate.addEventListener("click", () => find(true));

    // ---- a site: shown on the map, and what Maps shows for it -----------------------------------------------------------------------
    function openSite(s) {
      if (!me.map || !FP.wqSites) return;
      // the sites as read here are the panel's own first read (wq-sites.js keeps its reads in this state), so nothing is read twice
      me.wq = me.wq || { cache: new Map([["sites", Promise.resolve({ rows: me.rows || [], where: "group" })]]), framed: true };
      me.wq.on = true; me.wq.chosen = [s.id]; me.wq.adding = false;
      try { me.overlay?.remove(); } catch { /* gone */ }
      try { me.overlay = FP.wqSites.attach({ map: me.map, holder: stage, sb, owner: { org: group.id }, state: me.wq }); } catch { me.overlay = null; }
      const h = stage.clientHeight || 400;
      me.map.easeTo({ center: s.lngLat, zoom: Math.max(me.map.getZoom(), 13), padding: { top: 24, bottom: Math.round(h * 0.55), left: 24, right: 24 }, duration: 0 });
    }

    // ---- the map, once the Home is on the page ------------------------------------------------------------------------------------
    const area = Promise.resolve().then(() => FP.home?.readShapes?.(sb, [], [group]) || new Map()).then((m) => m.get(group.id) || null, () => null);
    const sites = (async () => {
      const q = sb.rpc("group_wq_sites", { g: group.id });
      const r = await (q && typeof q.limit === "function" ? q.limit(P().READ_CAP) : q);
      if (r?.error) throw r.error;
      me.rows = (Array.isArray(r?.data) ? r.data : []).slice(0, P().READ_CAP);
      return P().sitesFrom(me.rows, FP.wqModel?.siteLngLat);
    })();
    sites.then((s) => { me.sites = s; draw(); }, () => { me.sites = false; draw(); });
    draw();

    function makeMap() {
      if (!live() || !wrap.isConnected) return;
      const gl = root.maplibregl;
      if (!gl) { mapBox.replaceChildren(el("p", { class: "pa-quiet" }, "The map couldn't open here.")); return; }
      try {
        gl.setWorkerUrl?.("vendor/maplibre-gl-csp-worker.f950e7b1.js");
        const plain = FP.mapPalette?.startBackground?.(null, FP.basemaps.names) || "aerial";
        const map = me.map = new gl.Map({ container: mapBox, style: FP.basemaps.style(plain), bounds: NZ, attributionControl: { compact: true }, pitchWithRotate: false, dragRotate: false });
        map.touchZoomRotate?.disableRotation?.();
        map.on("load", async () => {
          if (!live()) return;
          if (plain !== "aerial") FP.basemaps.pick(map, plain).catch(() => {});
          // the group's own soft hue, as Places draws it (map-palette.js)
          const cs = getComputedStyle(root.document.documentElement), css = (k) => cs.getPropertyValue(k);
          const hue = FP.mapPalette ? FP.mapPalette.hues(css)[FP.mapPalette.hueIndex(group.parent_org_id || group.id)] : "#5f9bd8";
          map.addSource("pa-area", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          map.addLayer({ id: "pa-area-fill", type: "fill", source: "pa-area", paint: { "fill-color": hue, "fill-opacity": 0.08 } });
          map.addLayer({ id: "pa-area-line", type: "line", source: "pa-area", paint: { "line-color": hue, "line-width": 1.5 } });
          map.addSource("pa-me", { type: "geojson", data: meData(me.located) });
          map.addLayer({ id: "pa-me-ring", type: "fill", source: "pa-me", filter: ["==", ["get", "kind"], "ring"], paint: { "fill-color": "#2f7de1", "fill-opacity": 0.14 } });
          map.addLayer({ id: "pa-me-dot", type: "circle", source: "pa-me", filter: ["==", ["get", "kind"], "dot"], paint: { "circle-radius": 7, "circle-color": "#2f7de1", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5 } });
          const shape = await area;
          if (!live()) return;
          let box = null;
          if (shape?.geometry) { map.getSource("pa-area").setData({ type: "Feature", properties: {}, geometry: shape.geometry }); box = shape.bbox; }
          if (!box) {
            const s = await sites.catch(() => []);
            const pts = (s || []).map((x) => x.lngLat);
            if (pts.length) box = [[Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))], [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]];
          }
          if (!live()) return;
          if (box && !me.located) map.fitBounds(box, { padding: 32, maxZoom: 14, duration: 0 });
          const c = map.getCenter();
          me.centre = { lat: c.lat, lon: c.lng };
          draw();
        });
      } catch { mapBox.replaceChildren(el("p", { class: "pa-quiet" }, "The map couldn't open here.")); }
    }
    root.requestAnimationFrame?.(() => root.requestAnimationFrame(makeMap));
    // already allowed: the person's position at once, without a prompt
    FP.locate?.permission?.().then((s) => { if (s === "granted" && live()) find(false); });
    return wrap;
  }

  function close() {
    const me = shown;
    shown = null;
    if (!me) return;
    me.alive = false;
    try { me.stop?.(); } catch { /* gone */ }
    try { me.overlay?.remove(); } catch { /* gone */ }
    try { me.map?.remove(); } catch { /* gone */ }
  }

  FP.phoneArea = { view, close, phone };
})(window);
