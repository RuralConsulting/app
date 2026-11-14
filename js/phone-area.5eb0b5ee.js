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
  const BASE_KEY = "fp-overview-basemap";   // the overviews' background, remembered on this device (map-scene.js, group-overview.js)
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
  // only the map: the group's outer outline, one small name at the centre of each sub-group, Locate me and the +. PH5 (the owner,
  // 14 Nov 2026): the aerial first, everything outside the area darkened (map-palette.js MASK_OPACITY), each sub-group a clear fill,
  // and a tap on a name or a fill zooms there and opens it (goTo). Search is the bar's (space-nav.js). "Near you" is a small sheet that comes up only once Locate me is tapped, and closes.
  function view({ group, sb = FP.sb }) {
    close();
    const me = { place: group.id, alive: true, map: null, overlay: null, stop: null, wq: null, sites: null, rows: null, located: null, centre: null, timer: null, open: false, labels: [] };
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

    // ---- PH5: a tap goes there (the owner, 14 Nov 2026: "Don't have it have to approve opening a group once you click on it on the
    // map, just zoom to it smoothly") ---------------------------------------------------------------------------------------------
    // A sub-group's name or its fill, tapped: the map eases to it (about 750 ms; at once where the person asks for less motion), and
    // then the person is in it (its own Home, its own mask) when they may open it; one they may not open is only zoomed to, its name
    // showing. MapLibre gives no click after a drag or a pinch, so neither ever navigates. The header's back leads up again.
    const FLY_MS = 750, LAST_MS = 2000, PRESSES = ["pointerdown", "touchstart", "mousedown", "wheel"];
    const reduced = () => !!root.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // Review of #540, 1: the open belongs to one fly. Any touch or press the person makes anywhere on the screen while it flies (the map:
    // a drag, a pinch; Locate, the +, the bar or any control: review of #540, round 3), or a wheel, cancels it, and so does another tap
    // (which flies on its own); the place opens only when its fly ends uninterrupted. Returns the cancel (also me.cancelGo).
    function goTo(s) {
      const map = me.map, x = me.subs?.get(s.id);
      if (!map || !x || !live()) return null;
      me.cancelGo?.();
      const fly = { s, live: true };
      me.going = s.id;
      const doc = root.document;
      const stop = () => {
        fly.live = false;
        if (me.going === s.id) me.going = null;
        for (const ev of PRESSES) doc?.removeEventListener(ev, cancel, true);
        map.off("movestart", byPerson); map.off("moveend", ended);
        root.clearTimeout(fly.timer); root.clearTimeout(fly.last);
        for (const l of me.labels) if (l.id === s.id) l.node.classList.remove("pa-going");
        if (me.cancelGo === stop) me.cancelGo = null;
      };
      const cancel = () => { if (fly.live) stop(); };
      const byPerson = (e) => { if (e?.originalEvent) cancel(); };
      // (force: the last word, a bounded time after the fly should have ended: a map that never reports rest, say with its tiles failing,
      // still takes the person there; a move of theirs has cancelled it before then)
      const open = (force = false) => {
        if (!fly.live || !live() || me.going !== s.id || (!force && map.isMoving?.())) return;
        const go = s.member;
        stop();
        if (go) root.location.hash = FP.href(FP.groupModel.href(s.id, "home"));
      };
      const ended = (e) => { if (!e?.originalEvent) open(); };
      me.cancelGo = stop;
      for (const l of me.labels) l.node.classList.toggle("pa-going", l.id === s.id);
      const ms = reduced() ? 0 : FLY_MS;
      map.fitBounds(x.bbox, { padding: { top: 72, bottom: 84, left: 28, right: 28 }, maxZoom: 14, duration: ms, essential: false });
      // (listened for after the fly starts, so the end of a fly it stopped is not taken for its own)
      for (const ev of PRESSES) doc?.addEventListener(ev, cancel, true);
      map.on("movestart", byPerson);
      if (ms) map.on("moveend", ended);
      // with no fly (reduced motion, or already there) the open waits a moment for a touch; otherwise it is a safety net once the fly
      // should have ended, and opens only if the map is at rest and nothing cancelled it
      fly.timer = root.setTimeout(open, ms ? ms + 400 : 150);
      fly.last = root.setTimeout(() => open(true), ms + LAST_MS);
      return stop;
    }
    me.goTo = goTo;

    // ---- the sub-groups' names, one at the centre of each (a tap goes there) -----------------------------------------------------
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
      const drawn = subs.filter((s) => shapes.get(s.id)?.geometry);
      // PH5: each sub-group's own fill, in the set that tells neighbours apart (map-palette.js subgroupColours), the same on every map
      // (every sub-group, with an area or not, keyed by its id: the same set and keys the Maps tab colours, review of #540, 2)
      const colours = FP.mapPalette?.subgroupColours?.(subs.map((s) => ({ key: s.id, name: s.name, geometry: shapes.get(s.id)?.geometry || null }))) || new Map();
      me.subs = new Map(drawn.map((s) => [s.id, { ...s, bbox: shapes.get(s.id).bbox }]));
      const look = (c) => FP.mapPalette?.subgroupLook?.(c, { onDark: me.onDark }) || { fill: c, fillOpacity: 0.5, line: c, lineWidth: 0.75, lineOpacity: 0.9 };
      me.map.getSource("pa-subs")?.setData({ type: "FeatureCollection", features: drawn.map((s) => {
        const lk = look(colours.get(s.name) || "#3a86ff");
        return { type: "Feature", geometry: shapes.get(s.id).geometry, properties: { id: s.id, fill: lk.fill, fo: lk.fillOpacity, line: lk.line } };
      }) });
      me.labels = drawn.map((s) => {
        const shape = shapes.get(s.id), at = P().labelPoint(shape.geometry);
        // review of #538, 1, and PH5: a tap on any name zooms to its sub-group; only one the person is in is then opened (as the computer's
        // overview links them); another's is zoomed to and its name shown, nothing more
        const node = el("button", { type: "button", class: "pa-label" + (s.member ? "" : " pa-label-only"), "data-sub": s.id, "data-open": String(!!s.member), title: s.name,
          "aria-label": s.member ? "Open " + s.name + " (sub-group)" : "Zoom to " + s.name + " (sub-group)" }, s.name);
        node.addEventListener("click", () => goTo(s));
        layer.append(node);
        return { id: s.id, node, at, size: (shape.bbox[1][0] - shape.bbox[0][0]) * (shape.bbox[1][1] - shape.bbox[0][1]) };
      }).filter((x) => x.at).sort((a, b) => b.size - a.size);
      stage.append(layer);
      placeLabels();
      // a tap on a sub-group's fill goes there too (the smallest under the finger, where two overlap)
      me.map.on("click", "pa-subs-fill", (e) => {
        const hit = (e.features || []).map((f) => me.subs.get(f.properties.id)).filter(Boolean).sort((a, b) => (a.bbox[1][0] - a.bbox[0][0]) * (a.bbox[1][1] - a.bbox[0][1]) - (b.bbox[1][0] - b.bbox[0][0]) * (b.bbox[1][1] - b.bbox[0][1]))[0];
        if (hit) goTo(hit);
      });
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
        // PH5: the aerial, unless the person chose the plain map on an overview on this phone (map-scene.js's own key)
        let stored = null; try { stored = root.localStorage.getItem(BASE_KEY); } catch { /* private mode */ }
        // (the demo has no tiles: its two choices stand over the plain ground, as on the other overviews)
        const choices = FP.basemaps.names.length >= 2 ? FP.basemaps.names : FP.demo?.active ? ["aerial", "topo"] : [];
        const start = me.base = FP.mapPalette?.startBackground?.(stored, choices) || "aerial";
        me.onDark = start === "aerial" ? !FP.basemaps.missingKey || /dark/.test(getComputedStyle(root.document.documentElement).colorScheme || "") : false;
        // PH2: the credit is the small "i" in the bottom left (its terms need it within reach; tapping it shows it), never a dark box
        // across the map under the +, which sits bottom right above the list
        const map = me.map = new gl.Map({ container: mapBox, style: FP.basemaps.style(start, { reliefOnAerial: false }), bounds: NZ, attributionControl: false, pitchWithRotate: false, dragRotate: false });
        map.addControl(new gl.AttributionControl({ compact: true }), "bottom-left");
        FP.basemaps.quietCredit?.(map);
        map.touchZoomRotate?.disableRotation?.();
        map.on("load", async () => {
          if (!live()) return;
          if (start !== "aerial") FP.basemaps.pick(map, start).catch(() => {});
          // the group's own soft hue, as Places draws it (map-palette.js); PH2: one thin line, the group's outer edge only (the owner:
          // "show the group first"), over the faintest fill. PH5: everything outside the area under the mask, so the line is quiet
          const cs = getComputedStyle(root.document.documentElement), css = (k) => cs.getPropertyValue(k);
          const hue = FP.mapPalette ? FP.mapPalette.hues(css)[FP.mapPalette.hueIndex(group.parent_org_id || group.id)] : "#5f9bd8";
          const look = FP.mapPalette?.look(hue, { onDark: me.onDark }) || { line: hue };
          const none = { type: "FeatureCollection", features: [] };
          map.addSource("pa-mask", { type: "geojson", data: none });
          map.addSource("pa-area", { type: "geojson", data: none });
          map.addSource("pa-subs", { type: "geojson", data: none });
          map.addSource("pa-edge", { type: "geojson", data: none });
          // (the mask first: under the area, the sub-groups, the outline and the person's dot; the names and controls are over the map)
          map.addLayer({ id: "pa-mask", type: "fill", source: "pa-mask", paint: { "fill-color": "#000000", "fill-opacity": FP.mapPalette?.MASK_OPACITY ?? 0.35, "fill-antialias": false } });
          map.addLayer({ id: "pa-area-fill", type: "fill", source: "pa-area", paint: { "fill-color": hue, "fill-opacity": 0.06, "fill-antialias": false } });   // (no seams where the areas meet)
          // PH5: the sub-groups told apart by fill, a hairline of the same hue between neighbours, no dashed casing
          map.addLayer({ id: "pa-subs-fill", type: "fill", source: "pa-subs", paint: { "fill-color": ["get", "fill"], "fill-opacity": ["get", "fo"] } });
          map.addLayer({ id: "pa-subs-line", type: "line", source: "pa-subs", layout: { "line-join": "round" }, paint: { "line-color": ["get", "line"], "line-width": FP.mapPalette?.SUBGROUP_LINE ?? 0.75, "line-opacity": 0.9 } });
          map.addLayer({ id: "pa-area-line", type: "line", source: "pa-edge", layout: { "line-join": "round" }, paint: { "line-color": me.onDark ? "#ffffff" : look.line, "line-width": 1, "line-opacity": 0.7 } });
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
              // PH5: the mask from the same kept outline (worked out once per outline: map-palette.js outsideMask)
              const mask = edge && FP.mapPalette?.outsideMask?.(edge);
              if (mask && live() && map.getSource("pa-mask")) map.getSource("pa-mask").setData(mask);
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
    try { me.cancelGo?.(); } catch { /* gone */ }
    try { me.stop?.(); } catch { /* gone */ }
    try { me.overlay?.remove(); } catch { /* gone */ }
    try { me.map?.remove(); } catch { /* gone */ }
  }

  FP.phoneArea = { view, close, phone, debug: () => shown?.map || null, base: () => shown?.base || null, place: () => shown?.place || null };
})(window);
