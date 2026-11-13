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

  // opts: { group: { id, name }, sb }. Returns the Home element; the map is made once it is on the page.
  // PH2 (the owner, 13 Nov 2026: "For the Home Screen the rest is the map just showing the overview view of the group… maybe just a
  // label in the centre of where each subgroup is to quickly navigate to them if you want to (but not forced to)"): Home on a phone is
  // only the map: the group's outer outline, one small name at the centre of each sub-group (a tap offers to open it), Locate me and
  // the +. Search is the bar's (space-nav.js). "Near you" is a small sheet that comes up only once Locate me is tapped, and closes.
  function view({ group, sb = FP.sb }) {
    close();
    const me = { alive: true, map: null, overlay: null, stop: null, wq: null, sites: null, rows: null, located: null, centre: null, timer: null, open: false, labels: [] };
    shown = me;
    const live = () => me.alive && shown === me;
    const mapBox = el("div", { class: "pa-map", id: "pa-map", role: "region", "aria-label": "Map of " + group.name });
    const locate = el("button", { type: "button", class: "pa-locate", id: "pa-locate", "aria-label": "Locate me", title: "Locate me" }, FP.icon("locate", 22));
    const stage = el("div", { class: "pa-stage" }, mapBox, locate);
    const line = el("p", { class: "pa-line", id: "pa-line" });
    const say = el("div", { class: "pa-say", id: "pa-say", role: "status", "aria-live": "polite" });
    const set = el("ul", { class: "pa-set", id: "pa-near", "aria-label": "Near you" });
    const shut = el("button", { type: "button", class: "pa-shut", id: "pa-shut", "aria-label": "Close Near you", onclick: () => openSheet(false) }, FP.icon("close", 20));
    const sheet = el("section", { class: "pa-sheet", id: "pa-sheet", "aria-labelledby": "pa-near-title", hidden: true },
      el("div", { class: "pa-sheet-head" }, el("h2", { id: "pa-near-title" }, "Near you"), shut), line, say, set);
    const wrap = el("section", { class: "pa", "data-view": "home", "aria-label": "Home" }, stage, sheet);
    me.wrap = wrap;
    function openSheet(on) {
      me.open = on; sheet.hidden = !on;
      if (on) draw(); else { problem(null); locate.focus({ preventScroll: true }); }
      root.requestAnimationFrame?.(() => { me.map?.resize(); placeLabels(); });
      for (const ms of [450, 900]) root.setTimeout?.(() => live() && placeLabels(), ms);   // once the + has settled above the sheet (add.js)
    }

    // ---- the list -------------------------------------------------------------------------------------------------------------
    // PH2: a name in capitals (Environment Canterbury's) is shown in sentence case and wraps to two lines (phone-model displayName)
    const row = (s) => el("li", {}, el("button", { type: "button", class: "pa-row", "data-site": String(s.id), onclick: () => openSite(s), title: s.name },
      el("span", { class: "pa-dot", "aria-hidden": "true" }, FP.icon("water", 18)),
      el("span", { class: "pa-name" }, P().displayName(s.name)), el("span", { class: "pa-far" }, s.words)));
    function draw() {
      if (!live()) return;
      if (me.finding && !me.located) { line.textContent = "Finding your position…"; set.replaceChildren(); set.hidden = true; return; }
      if (me.sites === null) { line.textContent = "Looking for what is near…"; set.replaceChildren(); set.hidden = true; return; }
      if (me.sites === false) { line.textContent = P().SITES_FAILED; set.replaceChildren(); set.hidden = true; return; }
      const from = me.located || me.centre;
      const near = P().nearby(me.sites, from);
      const said = near.length ? P().nearbyLine({ located: !!me.located, fix: me.located, count: near.length }) : P().NO_SITES;
      // PH2: before locating, one quiet hint with the Locate icon in it, instead of "Nearest to the middle of the map"
      if (said) line.textContent = said;
      else line.replaceChildren(P().LOCATE_HINT[0], FP.icon("locate", 15), P().LOCATE_HINT[1]);
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
    // tapped (fly): the phone is asked from the tap itself (locate.js), and Near you comes up; already allowed when Home opens: the dot
    // only, quietly
    async function find(fly) {
      const asked = FP.locate.get({ maxAge: 5000 });
      locate.disabled = true; locate.classList.add("pa-busy"); problem(null);
      if (fly) { me.finding = true; openSheet(true); }
      const got = await asked;
      if (!live()) return;
      me.finding = false;
      locate.disabled = false; locate.classList.remove("pa-busy");
      if (!got.ok) { locate.setAttribute("aria-pressed", "false"); if (fly) { problem(got.problem); draw(); } return; }
      showMe(got.fix, fly);
      if (!me.stop) me.stop = FP.locate.watch((f) => showMe(f, false));
    }
    locate.addEventListener("click", () => find(true));

    // ---- the sub-groups' names, one at the centre of each (a tap offers to open it; never forced) -------------------------------
    // Drawn over the map; where two would touch, or one would sit on a control, the smaller sub-group's name waits until zoomed in.
    function placeLabels() {
      const map = me.map;
      if (!map || !me.labels.length) return;
      const h = stage.getBoundingClientRect();
      const blockers = [locate, ...stage.querySelectorAll(".maplibregl-ctrl-bottom-left > *, .maplibregl-ctrl-bottom-right > *"), ...root.document.querySelectorAll(".add-button:not([hidden])")]
        .filter((n) => n.getClientRects().length).map((n) => { const r = n.getBoundingClientRect(); return { l: r.left - h.left - 4, t: r.top - h.top - 4, r: r.right - h.left + 4, b: r.bottom - h.top + 4 }; });
      const boxes = me.labels.map((x) => {
        if (!x.w && x.node.offsetWidth) { x.w = x.node.offsetWidth; x.h = x.node.offsetHeight; }   // measured while it shows
        const p = map.project(x.at), w = x.w || 120, ht = x.h || 28;
        return { l: p.x - w / 2, t: p.y - ht / 2, r: p.x + w / 2, b: p.y + ht / 2, x: p.x, y: p.y };
      });
      const keep = P().keepLabels(boxes, blockers, { width: h.width, height: h.height });
      me.labels.forEach((x, i) => {
        x.node.hidden = !keep.has(i);
        x.node.style.transform = "translate(" + Math.round(boxes[i].x) + "px, " + Math.round(boxes[i].y) + "px) translate(-50%, -50%)";
      });
    }
    async function drawLabels() {
      const subs = await readSubgroups();
      if (!live() || !subs.length) return;
      const shapes = await Promise.resolve(FP.home?.readShapes?.(sb, [], subs)).catch(() => null);
      if (!live() || !shapes) return;
      const layer = el("div", { class: "pa-labels", "aria-label": "Sub-groups" });
      me.labels = subs.filter((s) => shapes.get(s.id)?.geometry).map((s) => {
        const shape = shapes.get(s.id), at = P().labelPoint(shape.geometry);
        // review of #538, 1: only a sub-group the person is in may be opened from here (as the computer's overview links them); another's
        // name is shown and nothing more (not a button)
        const node = s.member ? el("button", { type: "button", class: "pa-label", "data-sub": s.id, title: s.name, "aria-label": s.name + " (sub-group)" }, s.name)
          : el("span", { class: "pa-label pa-label-only", "data-sub": s.id }, s.name);
        if (s.member) node.addEventListener("click", () => FP.sheet?.menu(node, s.name, [{ label: "Open " + s.name, icon: "places", href: FP.href(FP.groupModel.href(s.id, "home")) }], "Sub-group of " + group.name));
        layer.append(node);
        return { id: s.id, node, at, size: (shape.bbox[1][0] - shape.bbox[0][0]) * (shape.bbox[1][1] - shape.bbox[0][1]) };
      }).filter((x) => x.at).sort((a, b) => b.size - a.size);
      stage.append(layer);
      placeLabels();
      // (once a frame at most while the map moves)
      let queued = false;
      me.map.on("move", () => { if (queued) return; queued = true; root.requestAnimationFrame(() => { queued = false; if (live()) placeLabels(); }); });
    }
    // the group's sub-groups, as its overview reads them (subgroup_counts: their names, for any member), and the ones the person is in
    async function readSubgroups() {
      if (group.parent_org_id) return [];
      try {
        const { data, error } = await sb.rpc("subgroup_counts", { parent_org: group.id });
        if (error) throw error;
        return (Array.isArray(data) ? data : []).map((r) => ({ id: r.subgroup_id, name: r.subgroup_name, parent_org_id: group.id, member: !!r.is_member })).filter((s) => s.id && s.name).slice(0, 40);
      } catch { return (FP.groupSpace?.groups?.() || []).filter((g) => g.parent_org_id === group.id).map((g) => ({ ...g, member: true })).slice(0, 40); }
    }

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
        // PH2: the credit is the small "i" in the bottom left (its terms need it within reach; tapping it shows it), never a dark box
        // across the map under the +, which sits bottom right above the list
        const map = me.map = new gl.Map({ container: mapBox, style: FP.basemaps.style(plain), bounds: NZ, attributionControl: false, pitchWithRotate: false, dragRotate: false });
        map.addControl(new gl.AttributionControl({ compact: true }), "bottom-left");
        FP.basemaps.quietCredit?.(map);
        map.touchZoomRotate?.disableRotation?.();
        map.on("load", async () => {
          if (!live()) return;
          if (plain !== "aerial") FP.basemaps.pick(map, plain).catch(() => {});
          // the group's own soft hue, as Places draws it (map-palette.js); PH2: one thin line, the group's outer edge only (the owner:
          // "show the group first"), over the faintest fill
          const cs = getComputedStyle(root.document.documentElement), css = (k) => cs.getPropertyValue(k);
          const hue = FP.mapPalette ? FP.mapPalette.hues(css)[FP.mapPalette.hueIndex(group.parent_org_id || group.id)] : "#5f9bd8";
          const look = FP.mapPalette?.look(hue, { onDark: plain === "aerial" }) || { line: hue };
          const none = { type: "FeatureCollection", features: [] };
          map.addSource("pa-area", { type: "geojson", data: none });
          map.addSource("pa-edge", { type: "geojson", data: none });
          map.addLayer({ id: "pa-area-fill", type: "fill", source: "pa-area", paint: { "fill-color": hue, "fill-opacity": 0.06, "fill-antialias": false } });   // (no seams where the areas meet)
          map.addLayer({ id: "pa-area-line", type: "line", source: "pa-edge", layout: { "line-join": "round" }, paint: { "line-color": look.line, "line-width": 1.25 } });
          map.addSource("pa-me", { type: "geojson", data: meData(me.located) });
          map.addLayer({ id: "pa-me-ring", type: "fill", source: "pa-me", filter: ["==", ["get", "kind"], "ring"], paint: { "fill-color": "#2f7de1", "fill-opacity": 0.14 } });
          map.addLayer({ id: "pa-me-dot", type: "circle", source: "pa-me", filter: ["==", ["get", "kind"], "dot"], paint: { "circle-radius": 7, "circle-color": "#2f7de1", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5 } });
          const shape = await area;
          if (!live()) return;
          let box = null;
          if (shape?.geometry) {
            map.getSource("pa-area").setData({ type: "Feature", properties: {}, geometry: shape.geometry });
            box = shape.bbox;
            // review of #538, 9: the outline after the map is drawn, never before; worked out once per group and area (phone-model
            // outlineFor: kept in memory and on this phone, by a hash of the area), so a Home opened again draws it at once
            let store = null; try { store = root.localStorage; } catch { /* private mode */ }
            const drawEdge = () => {
              if (!live()) return;
              const edge = P().outlineFor(shape.geometry, { store, key: group.id });
              if (edge && live() && map.getSource("pa-edge")) map.getSource("pa-edge").setData({ type: "Feature", properties: {}, geometry: edge });
            };
            if (P().outlineHeld(shape.geometry, { store, key: group.id })) drawEdge();
            else if (root.requestIdleCallback) root.requestIdleCallback(drawEdge, { timeout: 600 }); else root.setTimeout(drawEdge, 50);
          }
          if (!box) {
            const s = await sites.catch(() => []);
            const pts = (s || []).map((x) => x.lngLat);
            if (pts.length) box = [[Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))], [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]];
          }
          if (!live()) return;
          if (box && !me.located) map.fitBounds(box, { padding: { top: 72, bottom: 84, left: 28, right: 28 }, maxZoom: 14, duration: 0 });
          const c = map.getCenter();
          me.centre = { lat: c.lat, lon: c.lng };
          draw();
          drawLabels().catch(() => {});
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

  FP.phoneArea = { view, close, phone, debug: () => shown?.map || null };
})(window);
