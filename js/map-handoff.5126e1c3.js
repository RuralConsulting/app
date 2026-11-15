// TR1 (the owner, 16 Nov 2026, from his iPhone: "The first load screen for me is inconsistent with the groups and therefore 'jumps'
// to that view. make sure transitions are smooth from page to page map to map, including if the symbology changes we need it to
// change smoothly not jump"): one continuous move from one map screen to the next, and symbols that fade rather than pop.
//
// How (docs/CATCHMENT-SPACE.md, "Smooth moves between maps (TR1)"). Each screen keeps its own MapLibre map (Places, a place's Home on
// a phone, the computer's overview, Maps, Water quality). Moving one map between screens of different sizes would resize its canvas
// after it was first drawn, which a browser built on WebKit shows as a blank map (map-keep.js); rewriting the screens onto one map
// was not safe with other work under way. So the map the person leaves HANDS OVER to the map they arrive at:
//   1. leaving: the instant the address changes (before any screen is swapped), the visible map is drawn once more and copied into a
//      picture (the "curtain"), with its camera, its box on the screen, its background and the place the person tapped (entering());
//   2. arriving: the new map is made at the camera that puts every point of the ground where it was on the screen (alignCenter: the
//      same zoom, the centre moved by the difference between the two boxes), with the curtain laid over its box, so the picture does
//      not move and nothing blank or grey shows while its style and tiles come;
//   3. once the new map has drawn there (its tiles, or at most REVEAL_CAP_MS), the curtain fades away (REVEAL_MS): the old map's own
//      symbols fade out as the new one's show through, at the same camera;
//   4. then the new map eases to its own frame (ease(): ONE easeTo, 350 to 900 ms by how far it goes; at once where the device asks
//      for less motion) while its place's symbols fade in (fade()).
// A deep link or a reload has nothing handed over: the place opens directly, as before. A hand-over is used once, and only within
// FRESH_MS of the address changing. Where the device asks for less motion nothing moves or fades, but the curtain still covers the new
// map until it has drawn, so there is never a blank flash.
// Within a map: fade() and refade() let a symbol change (a sub-group chosen, Surface water | Groundwater, a measure, a layer switched)
// fade out and in rather than vanish and reappear; basemaps.js swap() cross-fades Aerial | Topo.
// For the browser walks: <html data-map-moving="on"> while any hand-over, ease or fade runs, and settled() resolves once none does.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.mapHandoff = api; api.listen(); }
})(typeof window === "undefined" ? globalThis : window, function (root) {
  const TILE = 512;                 // MapLibre's world is 512 px wide at zoom 0
  const FRESH_MS = 6000;            // a hand-over not taken by then is dropped (the overview makes its map once its first read is back)
  const REVEAL_CAP_MS = 1200;       // the curtain waits at most this long for the new map's tiles
  const REVEAL_MS = 200;            // the curtain's fade
  const WAIT_MAP_MS = 1500;         // a page that has not made its map by then shows itself as it is (its own loading line)
  const MIN_WAIT_MS = 250;          // a map made late still gets this long to draw before the picture goes
  const MIN_MS = 350, MAX_MS = 900; // an ease: short for a short move, calm for a long one
  const FADE_MS = 300;

  // ---- pure parts (node-tested: tests/app/tr1.test.cjs) --------------------------------------------------------------------------
  const mercX = (lng) => (lng + 180) / 360;
  const mercY = (lat) => { const s = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
  const lngOf = (x) => x * 360 - 180;
  const latOf = (y) => (360 / Math.PI) * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - 90;
  // The centre for a map in box `to` that shows each point of the ground where the map in box `from` showed it (same zoom, no tilt or
  // turn). from: { center: [lng, lat], zoom, bearing, pitch }; boxes: { left, top, width, height } in the page's pixels.
  function alignCenter(from, fromBox, toBox) {
    if (!from?.center || !fromBox || !toBox) return from?.center || null;
    if (Math.abs(from.bearing || 0) > 0.01 || Math.abs(from.pitch || 0) > 0.01) return from.center.slice();
    const W = TILE * 2 ** from.zoom;
    const dx = (toBox.left + toBox.width / 2) - (fromBox.left + fromBox.width / 2), dy = (toBox.top + toBox.height / 2) - (fromBox.top + fromBox.height / 2);
    const x = mercX(from.center[0]) + dx / W, y = mercY(from.center[1]) + dy / W;
    return [lngOf(x), latOf(y)];
  }
  // Where a ground point is drawn, in the page's pixels, for a map at `camera` in `box` (no tilt or turn): the walk's check that the
  // picture did not move, and the tests'
  function project(lngLat, camera, box) {
    const W = TILE * 2 ** camera.zoom;
    return { x: box.left + box.width / 2 + (mercX(lngLat[0]) - mercX(camera.center[0])) * W, y: box.top + box.height / 2 + (mercY(lngLat[1]) - mercY(camera.center[1])) * W };
  }
  // How long an ease takes: by how far it goes (zoom levels, plus the pan in screens at the lower zoom); none for no move, none where the
  // device asks for less motion
  function durationFor(a, b, { reduced = false, width = 400 } = {}) {
    if (reduced || !a?.center || !b?.center) return 0;
    const dz = Math.abs((a.zoom || 0) - (b.zoom || 0)), W = TILE * 2 ** Math.min(a.zoom || 0, b.zoom || 0);
    const pan = Math.hypot((mercX(a.center[0]) - mercX(b.center[0])) * W, (mercY(a.center[1]) - mercY(b.center[1])) * W) / Math.max(200, width);
    const score = dz + pan;
    if (score < 0.02) return 0;
    return Math.round(MIN_MS + (MAX_MS - MIN_MS) * Math.min(1, score / 3));
  }
  // A paint value scaled by k (0 to 1): a number times k, an expression wrapped in ["*", k, ...] (data-driven opacities can't use
  // MapLibre's own transitions, so fades set the scale frame by frame)
  function scaled(full, k) {
    const kk = Math.round(Math.max(0, Math.min(1, k)) * 1000) / 1000;
    if (full == null) return kk;
    if (typeof full === "number") return Math.round(full * kk * 1000) / 1000;
    if (kk === 1) return full;
    return ["*", kk, full];
  }
  // a calm in-and-out curve
  const curve = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  // The opacity properties each kind of layer fades by
  const OPACITY = { fill: ["fill-opacity"], line: ["line-opacity"], circle: ["circle-opacity", "circle-stroke-opacity"], symbol: ["icon-opacity", "text-opacity"],
    raster: ["raster-opacity"], background: ["background-opacity"], "fill-extrusion": ["fill-extrusion-opacity"], heatmap: ["heatmap-opacity"] };
  // Taps during a move: the latest wins (a second tap mid-move goes to the second place; the first never opens)
  function latest() {
    let n = 0;
    return { next: () => ++n, is: (t) => t === n, cancel: () => { n++; } };
  }
  const fresh = (h, now, ms = FRESH_MS) => !!h && !h.taken && now - h.at <= ms;

  // ---- in the browser ---------------------------------------------------------------------------------------------------------------
  const doc = () => root.document;
  const now = () => (root.performance?.now ? root.performance.now() : Date.now());
  const reduced = () => !!root.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const raf = (f) => (root.requestAnimationFrame ? root.requestAnimationFrame(f) : setTimeout(() => f(now()), 16));
  // (a removed map keeps its container for a moment but has no style: nothing is asked of it then)
  const alive = (map) => { try { return !!map && !map._removed && !!map.style && !!map.getContainer?.().isConnected; } catch { return false; } };
  const rectOf = (node) => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };

  // the maps that can hand over: map -> { kind, base(), place() }
  const maps = new Map();
  let pending = null, entered = null, log = [];
  function register(map, info = {}) {
    if (!map) return () => {};
    maps.set(map, info);
    return () => { if (maps.get(map) === info) maps.delete(map); };
  }
  // the place the person is about to enter (tapped on Places, or a sub-group on Home): its shape, so the map they arrive at frames it
  // at once, without waiting for its own read of the same outline. { id, kind, geometry, bbox }
  function entering(place) { entered = place?.id ? { ...place, at: now() } : null; }
  function visible() {
    let best = null, area = 0;
    for (const [m] of maps) {
      if (!alive(m)) { maps.delete(m); continue; }
      const c = m.getContainer(), r = c.getBoundingClientRect();
      if (!r.width || !r.height || !c.getClientRects().length) continue;
      if (r.width * r.height > area) { best = m; area = r.width * r.height; }
    }
    return best;
  }
  // A map drawn once more and kept as a picture, with its camera and box
  function record(m, info, place = null) {
    let image = null;
    try {
      m.redraw?.();   // (a synchronous draw: the canvas holds a frame to copy only within the task that drew it)
      const c = m.getCanvas(), out = doc().createElement("canvas");
      out.width = c.width; out.height = c.height;
      out.getContext("2d").drawImage(c, 0, 0);
      image = out;
    } catch { image = null; }
    let base = null; try { base = info?.base?.() || null; } catch { base = null; }
    const rect = rectOf(m.getContainer());
    // the places' marks over the map (Places' badges and names, a Home's name pills) are drawn into the picture where they are on the
    // screen, so they fade with it rather than vanish with the screen (info.marks(): the page's own mark elements)
    if (image) { try { drawMarks(image.getContext("2d"), [...(info?.marks?.() || [])].slice(0, 60), rect, image.width / Math.max(1, rect.width)); } catch { /* the map alone */ } }
    const cam = { center: m.getCenter().toArray(), zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() };
    return { at: now(), camera: cam, rect, image, base, kind: info?.kind || null, place, taken: false };
  }
  // A mark drawn as the page shows it, simply: each box's background and rounded corners, a ring round a badge (its box-shadow), a logo,
  // and its words where the page put them, in the page's own font and colour (marks are small: a badge and a name pill)
  function drawMarks(g, nodes, origin, dpr) {
    const px = (v, size) => (/%$/.test(v) ? (size * parseFloat(v)) / 100 : parseFloat(v) || 0);
    const box = (x, y, w, h, r) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2))); else g.rect(x, y, w, h); };
    const ringOf = (shadow) => { const m = /(rgba?\([^)]*\)|#[0-9a-f]{3,8})\s+0px\s+0px\s+0px\s+([\d.]+)px/i.exec(shadow || ""); return m ? { colour: m[1], width: parseFloat(m[2]) } : null; };
    const clear = (c) => !c || c === "transparent" || /rgba\([^)]*,\s*0\)$/.test(c);
    const words = (text, cs) => {
      g.font = [cs.fontStyle, cs.fontWeight, cs.fontSize, cs.fontFamily].join(" ");
      g.fillStyle = cs.color; g.textBaseline = "middle"; g.textAlign = "left";
      const range = doc().createRange();
      for (const w of text.textContent.matchAll(/\S+/g)) {
        range.setStart(text, w.index); range.setEnd(text, w.index + w[0].length);
        const b = range.getBoundingClientRect();
        if (b.width) g.fillText(w[0], b.left - origin.left, b.top - origin.top + b.height / 2);
      }
    };
    const walk = (el, depth) => {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return;
      const r = el.getBoundingClientRect(), x = r.left - origin.left, y = r.top - origin.top, rad = px(cs.borderTopLeftRadius, Math.min(r.width, r.height));
      if (r.width && r.height) {
        g.save(); g.globalAlpha = Number(cs.opacity) || 1;
        const ring = ringOf(cs.boxShadow);
        if (ring) { box(x - ring.width, y - ring.width, r.width + 2 * ring.width, r.height + 2 * ring.width, rad + ring.width); g.fillStyle = ring.colour; g.fill(); }
        if (!clear(cs.backgroundColor)) { box(x, y, r.width, r.height, rad); g.fillStyle = cs.backgroundColor; g.fill(); }
        if (el.tagName === "IMG" && el.complete && el.naturalWidth) { box(x, y, r.width, r.height, rad); g.clip(); g.drawImage(el, x, y, r.width, r.height); }
        g.restore();
      }
      for (const n of el.childNodes) {
        if (n.nodeType === 3 && n.textContent.trim()) words(n, cs);
        else if (n.nodeType === 1 && depth < 5) walk(n, depth + 1);
      }
    };
    g.save(); g.scale(dpr, dpr);
    for (const n of nodes) if (n.getClientRects().length) walk(n, 0);
    g.restore();
  }
  // The address is changing: the map on screen now is kept as a picture (record), for the map the person arrives at
  function snap() {
    const m = visible(), info = m ? maps.get(m) : null;
    const place = entered && now() - entered.at < 2000 ? entered : null;
    entered = null;
    if (pending?.image && !pending.taken) { pending.image.width = 0; pending.image = null; }   // (the last one, never used: let go)
    if (!m) { pending = null; return null; }
    const mine = pending = record(m, info, place);
    setTimeout(() => { if (pending === mine && !mine.taken) { if (mine.image) mine.image.width = 0; mine.image = null; pending = null; } }, FRESH_MS + 100);
    note({ kind: "snap", from: info.kind || null, camera: pending.camera });
    return pending;
  }
  function note(e) { log.push({ ...e, t: Math.round(now()) }); if (log.length > 60) log = log.slice(-60); }

  // ---- busy, for the walks ----
  let busy = 0, waiters = [];
  function begin(maxMs = 4000) {
    busy++; flag();
    let done = false;
    const end = () => { if (done) return; done = true; clearTimeout(t); busy = Math.max(0, busy - 1); flag(); };
    const t = setTimeout(end, maxMs);   // (a map removed mid-move never says it ended)
    return end;
  }
  function flag() {
    const d = doc()?.documentElement;
    if (d) { if (busy) d.dataset.mapMoving = "on"; else delete d.dataset.mapMoving; }
    if (!busy) { const w = waiters; waiters = []; for (const f of w) f(); }
  }
  const settled = () => new Promise((res) => (busy ? waiters.push(res) : res()));

  // ---- the map arriving takes the hand-over ----
  // box: the new map's container (laid out at its final size). id: the place it is about (the hand-over's place is given only when it is
  // that one). Returns null when nothing was handed over (a deep link, a reload, a stale or used hand-over).
  function take({ box, id = null } = {}) {
    const h = pending;
    if (!box || !fresh(h, now())) return null;
    if (!rectOf(box).width || !rectOf(box).height) return null;
    h.taken = true;
    pending = null;
    return handOver(h, box, id);
  }
  // A change of what one map shows, cross-faded on the same map: its picture now laid over it (cover), the map changed under it, and the
  // picture faded once the map has drawn the change (reveal). Then, if the view changes too, one ease (Places stepping into a group).
  function still(map) {
    if (!alive(map)) return null;
    const h = record(map, maps.get(map) || null);
    if (!h.image) return null;
    h.taken = true;
    return handOver(h, map.getContainer(), null).cover();
  }
  function handOver(h, box, id) {
    const flat = Math.abs(h.camera.bearing) < 0.01 && Math.abs(h.camera.pitch) < 0.01;
    let curtain = null, end = null, drawnAt = null, coveredAt = null, revealing = null, watched = null, touched = false, gone = null;
    const goneP = new Promise((r) => { gone = r; });
    // the picture's pixels let go once it has gone (a phone's full-resolution copy is about 12 MB)
    const release = () => { try { if (h.image) h.image.width = 0; } catch { /* gone */ } h.image = null; if (pending === h) pending = null; };
    // (the curtain is laid where the box is when covered; a box that has since moved or changed size, as a page settling round it,
    // is followed by refit(), and the camera is always worked out for where the box is now)
    // the curtain: a box fixed where the new map's box is, holding the picture
    function paint(wrap, to) {
      const c = wrap.firstChild, dpr = h.image.width / Math.max(1, h.rect.width);
      c.width = Math.round(to.width * dpr); c.height = Math.round(to.height * dpr);
      const g = c.getContext("2d");
      // (where the old box did not reach, nothing: the new page shows there, as it is)
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(h.image, (h.rect.left - to.left) * dpr, (h.rect.top - to.top) * dpr, h.rect.width * dpr, h.rect.height * dpr);
      Object.assign(c.style, { position: "absolute", left: "0", top: "0", width: to.width + "px", height: to.height + "px" });
      Object.assign(wrap.style, { left: to.left + "px", top: to.top + "px", width: to.width + "px", height: to.height + "px" });
      drawnAt = to;
    }
    const self = {
      base: h.base, from: h.kind, place: h.place && (!id || h.place.id === id) ? h.place : null, reduced: reduced(),
      // taken after WAIT_MAP_MS from the address change: the page has shown itself as it is (its loading line) by now, so a page that
      // makes its map only once its reads are back (Water quality) uses the camera only and lays no picture of the screen left
      late: now() - h.at > WAIT_MAP_MS,
      // the camera that keeps the ground where it was on the screen, for the box as it is now
      get camera() { return self.cameraFor(box); },
      cameraFor(node) { const to = rectOf(node); return { center: alignCenter(h.camera, h.rect, to), zoom: h.camera.zoom, bearing: flat ? 0 : h.camera.bearing, pitch: flat ? 0 : h.camera.pitch }; },
      // the picture over the new map's box, fixed where it was on the screen (under the page's bars and sheets, over the map)
      // (inside: put in the new map's own box, so the page's panels, cards, controls and names over that box stay over the picture; a
      // page that replaces its box's content while it loads (Maps) keeps the picture on the page itself)
      cover({ inside = true } = {}) {
        if (curtain || !h.image) return self;
        try {
          const c = doc().createElement("div");
          c.className = "map-curtain" + (inside ? "" : " on-page"); c.setAttribute("aria-hidden", "true"); c.inert = true;
          c.append(doc().createElement("canvas"));
          paint(c, rectOf(box));
          // (inside: just after the map's own box, so it is over the map and under what the page puts over the map after it)
          if (inside) box.after(c); else doc().body.append(c);
          curtain = c; coveredAt = now(); end = begin(WAIT_MAP_MS + REVEAL_CAP_MS + REVEAL_MS + 500);
          // (a page whose map is not made soon, its own reads still on their way, does not keep the picture: it shows itself as it is)
          setTimeout(() => { if (curtain === c && !watched) self.reveal(); }, WAIT_MAP_MS);
          note({ kind: "cover", from: h.kind });
        } catch { curtain = null; }
        return self;
      },
      // (a map made in the box after the picture was laid there would draw over it: the picture is put back on top)
      raise() { if (curtain && curtain.parentNode === box.parentNode && box.nextSibling !== curtain) box.after(curtain); return self; },
      // The new map, as soon as it is made: the picture goes once it has drawn at the handed camera (at most REVEAL_CAP_MS from the
      // picture's arrival), whatever the page's own reads are doing, and from then the map is the person's: a drag, pinch, wheel or
      // turn is noted (touched()), and the page's one ease to its frame, when its read lands later, is not made over it.
      watch(map) {
        if (watched || !map) return self;
        watched = map;
        const mark = (e) => { if (e?.originalEvent) { touched = true; note({ kind: "touched" }); } };
        try { for (const ev of ["dragstart", "zoomstart", "rotatestart", "pitchstart"]) map.on(ev, mark); } catch { /* gone */ }
        try { map.getCanvasContainer?.().addEventListener("wheel", () => { touched = true; }, { passive: true }); } catch { /* gone */ }
        self.reveal(map);
        return self;
      },
      touched: () => touched,
      // the page may move to its frame now: not when the person has taken the map, nor while it is moving for some other reason
      mayMove: (map) => !touched && !(map?.isMoving?.()),
      gone: goneP,
      refit() {
        const to = rectOf(box);
        if (curtain && h.image && to.width && to.height && (!drawnAt || ["left", "top", "width", "height"].some((k) => Math.abs(to[k] - drawnAt[k]) > 0.5))) { try { paint(curtain, to); } catch { /* as it was */ } }
        return self;
      },
      // once the new map has drawn at the handed camera: the curtain fades away. Resolves when it has gone.
      // (the same promise for every caller: the picture goes once)
      reveal(map) {
        if (map && !watched) return self.watch(map) && revealing;
        if (revealing) return revealing;
        revealing = (async () => {
          self.raise();
          if (map) await drawn(map, Math.max(MIN_WAIT_MS, REVEAL_CAP_MS - (coveredAt == null ? 0 : now() - coveredAt)));
          const c = curtain;
          curtain = null;
          if (c) {
            const ms = reduced() ? 0 : REVEAL_MS;
            note({ kind: "reveal", ms });
            if (ms) { c.style.transition = "opacity " + ms + "ms ease"; raf(() => { c.style.opacity = "0"; }); await new Promise((r) => setTimeout(r, ms + 40)); }
            c.remove(); end?.(); end = null;
          }
          release(); gone();
        })();
        return revealing;
      },
      drop() { curtain?.remove(); curtain = null; end?.(); end = null; release(); gone(); },
      covering: () => !!curtain,
    };
    return self;
  }
  // The map has drawn what it can at its camera: its style, and the tiles in view (or at most REVEAL_CAP_MS)
  function drawn(map, cap = REVEAL_CAP_MS) {
    return new Promise((res) => {
      let done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(t); try { map.off("idle", check); map.off("sourcedata", check); map.off("load", check); } catch { /* gone */ } res(); };
      const t = setTimeout(finish, cap);
      const check = () => {
        if (!alive(map)) { finish(); return; }
        try { if (map.isStyleLoaded?.() && map.areTilesLoaded?.() !== false) map.once("render", finish); } catch { finish(); }
      };
      try { map.on("idle", check); map.on("sourcedata", check); map.on("load", check); map.triggerRepaint?.(); } catch { finish(); }
      check();
    });
  }

  // ---- the camera: one ease to the new frame ----
  // target: { bounds, padding, maxZoom } or a camera { center, zoom }. Resolves when it has arrived (or was taken over by the person).
  function ease(map, target, { maxMs = MAX_MS } = {}) {
    if (!alive(map)) return Promise.resolve(false);
    let cam = target;
    if (target?.bounds) {
      try { cam = map.cameraForBounds(target.bounds, { padding: target.padding ?? 40, maxZoom: target.maxZoom ?? 17 }); } catch { cam = null; }
      if (!cam) return Promise.resolve(false);
      cam = { center: Array.isArray(cam.center) ? cam.center : [cam.center.lng, cam.center.lat], zoom: cam.zoom };
    }
    const from = { center: map.getCenter().toArray(), zoom: map.getZoom() };
    const ms = Math.min(maxMs, durationFor(from, cam, { reduced: reduced(), width: map.getContainer().clientWidth }));
    note({ kind: "ease", ms, from, to: cam });
    if (!ms) { map.jumpTo({ center: cam.center, zoom: cam.zoom, bearing: 0, pitch: 0 }); return Promise.resolve(true); }
    const end = begin(ms + 1500);
    return new Promise((res) => {
      const done = (ok) => { try { map.off("moveend", moved); } catch { /* gone */ } end(); res(ok); };
      const moved = () => done(true);
      map.on("moveend", moved);
      map.easeTo({ center: cam.center, zoom: cam.zoom, bearing: 0, pitch: 0, duration: ms, essential: true });
      setTimeout(() => done(true), ms + 1200);
    });
  }

  // ---- symbols: fades by opacity ----
  const fulls = new WeakMap(), levels = new WeakMap(), runs = new WeakMap();
  const per = (w, map) => { let m = w.get(map); if (!m) w.set(map, (m = new Map())); return m; };
  function propsOf(map, id) { try { return OPACITY[map.getLayer(id)?.type] || []; } catch { return []; } }
  function full(map, id, prop) {
    const m = per(fulls, map), k = id + "|" + prop;
    if (!m.has(k)) { let v; try { v = map.getPaintProperty(id, prop); } catch { v = undefined; } m.set(k, v ?? null); }
    return m.get(k);
  }
  // a layer at k of its own opacity (0 hidden, 1 as drawn)
  function setLevel(map, id, k) {
    if (!alive(map) || !map.getLayer?.(id)) return;
    for (const p of propsOf(map, id)) { try { map.setPaintProperty(id, p, scaled(full(map, id, p), k)); } catch { /* a property this layer refuses */ } }
    per(levels, map).set(id, k);
  }
  const level = (map, id) => (map ? per(levels, map).get(id) ?? 1 : 1);
  // the layer's own opacity changed by its page (a new look): kept as its full value from here
  function forget(map, ids) { const m = per(fulls, map); for (const id of [].concat(ids)) for (const k of [...m.keys()]) if (k.startsWith(id + "|")) m.delete(k); }
  // ids faded from their level now (or `from`) to `to` over ms; a newer fade of the same layer takes over from where this one is
  function fade(map, ids, { to = 1, from = null, ms = FADE_MS } = {}) {
    const list = [].concat(ids).filter((id) => alive(map) && map.getLayer?.(id));
    if (!list.length) return Promise.resolve();
    const run = {}, r = per(runs, map);
    for (const id of list) r.set(id, run);
    const start = new Map(list.map((id) => [id, from ?? level(map, id)]));
    if (reduced() || !ms) { for (const id of list) setLevel(map, id, to); return Promise.resolve(); }
    for (const id of list) setLevel(map, id, start.get(id));
    const end = begin(ms + 1500), t0 = now();
    return new Promise((res) => {
      const step = () => {
        const t = Math.min(1, (now() - t0) / ms), k = curve(t);
        let any = false;
        for (const id of list) if (r.get(id) === run && alive(map)) { any = true; setLevel(map, id, start.get(id) + (to - start.get(id)) * k); }
        if (t < 1 && any) raf(step); else { end(); res(); }
      };
      raf(step);
    });
  }
  // a value moved from 0 to 1 over ms (step(k) each frame, k on the calm curve); at once where the device asks for less motion
  function tween(ms, step) {
    if (reduced() || !ms) { step(1); return Promise.resolve(); }
    const end = begin(ms + 1500), t0 = now();
    return new Promise((res) => {
      const go = () => { const t = Math.min(1, (now() - t0) / ms); let ok = true; try { step(curve(t)); } catch { ok = false; } if (t < 1 && ok) raf(go); else { end(); res(); } };
      raf(go);
    });
  }
  // a change of what a layer shows: faded out, changed, faded in (at once where the device asks for less motion)
  async function refade(map, ids, change, { out = 140, back = 260 } = {}) {
    const list = [].concat(ids).filter((id) => alive(map) && map.getLayer?.(id));
    if (!list.length || reduced()) { change(); return; }
    await fade(map, list, { to: 0, ms: out });
    if (!alive(map)) return;
    change();
    await fade(map, list, { to: 1, ms: back });
  }
  // a layer switched on (shown at 0, then faded in) or off (faded out, then hidden), the latest choice winning
  async function toggle(map, ids, on, { ms = 220 } = {}) {
    const list = [].concat(ids).filter((id) => alive(map) && map.getLayer?.(id));
    const want = per(runs, map);
    const token = {};
    for (const id of list) want.set("vis|" + id, token);
    if (on) {
      for (const id of list) { if (map.getLayoutProperty(id, "visibility") === "none") { setLevel(map, id, 0); map.setLayoutProperty(id, "visibility", "visible"); } }
      await fade(map, list, { to: 1, ms });
    } else {
      await fade(map, list, { to: 0, ms });
      for (const id of list) if (want.get("vis|" + id) === token && alive(map) && map.getLayer(id)) { map.setLayoutProperty(id, "visibility", "none"); setLevel(map, id, 1); }
    }
  }

  // The address changes: the map on screen hands over (before main.js routes: this listener is added first, see index.html's order)
  let listening = false;
  function listen() {
    if (listening || typeof root.addEventListener !== "function") return;
    listening = true;
    // (a capturing listener: at the window it runs before every ordinary one, main.js's router included, whatever the scripts' order)
    root.addEventListener("hashchange", () => { try { snap(); } catch { pending = null; } }, true);
  }

  return { alignCenter, project, durationFor, scaled, curve, latest, fresh, OPACITY, FRESH_MS, REVEAL_CAP_MS, REVEAL_MS, WAIT_MAP_MS, MIN_MS, MAX_MS, FADE_MS,
    register, entering, snap, take, still, ease, fade, refade, toggle, tween, level, setLevel, forget, settled, listen, drawn,
    busy: () => busy, log: () => log.slice(), current: () => { const m = visible(); return m ? { map: m, kind: maps.get(m)?.kind || null } : null; }, pending: () => (pending && !pending.taken ? { at: pending.at, camera: pending.camera, rect: pending.rect, kind: pending.kind, place: pending.place?.id || null } : null) };
});
