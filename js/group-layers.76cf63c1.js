// The group map's own layers, read in parts (PERF3b). group_map (PERF3a) carries a light result: the group's area, the
// member-farms layer and every small layer inline; a large layer comes with no features, its `feature_count` and `bbox`,
// and `deferred: true`. Such a layer is listed in Layers with its count and read with
// public.group_layer_features(g, layer, x0, y0, x1, y1, tolerance_m, max_features) for the map in view when it is
// switched on: the tolerance from the zoom (about 20 m at the whole group, down to 0.5 m at paddock zoom), read again as
// the person pans and zooms (after the map has rested, debounced), each read kept per layer and box. When the box holds
// more than max_features the layer is not drawn in part: its row says "Zoom in to see <name> (<count>)". The group opens
// quiet, as a farm does: its area, the member farms and its member blocks (read once, simplified, right after the first
// paint, for the box the map frames); paddocks and the farm-plan layers stay off until switched on. A layer's read that
// fails never fails the group: its row says so, and the next switch reads it again.
// Incident #375 (an unbounded group_map read restarted the database): a deferred layer is NEVER read whole. Every
// group_layer_features call carries a box (the view, or the frame the map is flying to); with no view, nothing is read.
// Over the function's caps (features, and PERF3a's vertex cap) the answer is `truncated` and the row says to zoom in,
// for the member blocks' opening read too; a truncated layer is never asked again without a box.
// Either side may be deployed first: a group_map with every layer inline (no `deferred`, before PERF3a) draws as it did,
// everything on and nothing read; with group_layer_features missing (PostgREST 404 / PGRST202, Postgres 42883) a deferred
// layer says it couldn't load and the function is not asked again this session. No DOM, no clock of its own (the timer is
// the host's): the browser parts are group-space.js's and the Map scene's.
// CAP1b: the one module for both spaces. A farm's map (farm_map after CAP1a) defers a large farm-own layer the same way;
// create({ farm }) reads it with public.farm_layer_features(f, layer, x0, y0, x1, y1, tolerance_m, max_features), the
// same call with the farm as its owner, and the farm space (farm-space.js) hosts it as the group space does. add(id, item)
// takes another thing read by viewport with the item's own read (a farm's reference source whose entry came `truncated`:
// farm-reference.js's inView). Per layer: a read already on its way whose box holds the view, at a tolerance at least as
// fine, is waited for rather than asked again; and while the person pans, at most two reads are on their way (the one
// already asked and the one for the latest view): a view that comes while both are out waits, and only the latest such
// view is read when one of them lands.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api; else root.FP.groupLayers = api;
})(typeof window === "undefined" ? globalThis : window, function (root) {
  const list = (v) => (Array.isArray(v) ? v : []);
  const NONE = { type: "FeatureCollection", features: [] };
  // LK4: the kind registry (app/layer-kinds.json via layer-kinds.js) says what a group opens with.
  const K = () => (typeof module === "object" && module.exports ? require("./layer-kinds.js") : root.FP.kinds);
  const MAX_FEATURES = 4000;      // as group_layer_features' default: more in the box than this and the person zooms in
  const DEBOUNCE_MS = 300;        // after the map has rested, before the layers on are read for the new view
  const KEPT = 16;                // reads kept per layer (the oldest goes first)
  const IN_FLIGHT = 2;            // reads on their way per layer: the one already asked, and the one for the latest view
  // Simplification by zoom: about one screen pixel, to the step below it, from 20 m (the whole group) to 0.5 m (a paddock).
  const STEPS = [20, 10, 5, 2, 1, 0.5];
  const WHOLE = STEPS[0];
  // A function the database doesn't have yet (farm-reference.js's rule: its codes, never "does not exist").
  const missing = (e) => !!e && (e.code === "PGRST202" || e.code === "42883" || e.status === 404 || /could not find the function/i.test(String(e.message || "")));

  const isDeferred = (l) => !!l && l.deferred === true;
  const hasDeferred = (map) => list(map?.layers).some(isDeferred);
  // PERF3a's FIX: an entry group_map (or group_reference_context) could not bound carries `truncated: true`, its
  // feature_count and no features: listed, never drawn in part, never read here (the member-farms layer has no layer id to
  // read by). Its row says so.
  const tooMany = (x) => !!x && x.truncated === true;
  const tooManyLine = (n) => "Too many to show here" + (Number.isFinite(Number(n)) && n != null ? " (" + Number(n).toLocaleString("en-NZ") + ")" : "");
  // A deferred layer this loader reads by viewport: one of the group's own (a layer id), not truncated.
  const readable = (l) => isDeferred(l) && !tooMany(l) && l.group_own !== false && !!l.id;
  // The Map scene's `show` for the group (LK4, Josh's ruling): the group opens with its member blocks and Rivers only, as a
  // farm opens quiet, whatever was deferred. On: every row whose kind's default rule is quiet (the group's area, the member
  // blocks and the member farms' outlines) and the kinds config.js groupView.open names (["waterways"]: Rivers and the
  // group's own waterways). The rest of the catchment view (zones, monitoring sites) comes up by context or by hand; a
  // working or annotation layer is never on.
  const OPENING_KINDS = ["waterways"];
  function defaultShow(map, config = null) {
    const k = K(), on = k.kindsOn([], null), extra = new Set(list(config?.open).length ? config.open : OPENING_KINDS);
    const rows = [["extent", "extent"], ["rivers", "waterways"], ["member_farms", "member_blocks"],
      ...list(map?.layers).filter((l) => k.isData(l)).map((l) => [l.theme, k.kindOf(l.theme, l.geometry_type)])];
    return [...new Set(rows.filter(([, kind]) => kind && (on.has(kind) || extra.has(kind))).map(([key]) => key))];
  }
  // Metres per screen pixel at a zoom (MapLibre's 512 px tiles) and latitude, to the simplification step at or below it.
  function tolerance(zoom, lat = -43) {
    const z = Number(zoom);
    if (!Number.isFinite(z)) return WHOLE;
    const mpp = (40075016.686 * Math.cos((Number(lat) || 0) * Math.PI / 180)) / (512 * 2 ** z);
    return STEPS.find((s) => s <= mpp) ?? STEPS[STEPS.length - 1];
  }
  // The box read for a view ([[w, s], [e, n]]): the view and a quarter of it each side, its edges on a grid of a quarter of
  // its span (a power of two in degrees), so a small pan stays inside the box last read.
  function boxFor(bounds) {
    const [[w, s], [e, n]] = bounds, span = Math.max(e - w, n - s, 1e-6), pad = span / 4;
    const cell = 2 ** Math.floor(Math.log2(span / 4 || 1e-6));
    const down = (v) => Math.floor(v / cell) * cell, up = (v) => Math.ceil(v / cell) * cell, r = (v) => Number(v.toFixed(7));
    return { x0: r(down(w - pad)), y0: r(down(s - pad)), x1: r(up(e + pad)), y1: r(up(n + pad)) };
  }
  // What a view wants of a layer: its box and tolerance. Null without a view: a deferred layer is never read whole (#375).
  function want(view) {
    const b = view?.bounds;
    if (!Array.isArray(b) || ![b[0]?.[0], b[0]?.[1], b[1]?.[0], b[1]?.[1]].every(Number.isFinite)) return null;
    const tol = tolerance(view.zoom, (b[0][1] + b[1][1]) / 2), box = boxFor(b);
    return { box, tol, key: tol + "|" + [box.x0, box.y0, box.x1, box.y1].join(",") };
  }
  // The frame a geometry gives (the group's area: the view the map flies to at open), as a view at whole-group tolerance.
  function frameOf(geom) {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    const walk = (c) => { if (typeof c?.[0] === "number") { w = Math.min(w, c[0]); s = Math.min(s, c[1]); e = Math.max(e, c[0]); n = Math.max(n, c[1]); } else if (Array.isArray(c)) c.forEach(walk); };
    walk(geom?.coordinates);
    return Number.isFinite(w) && Number.isFinite(n) ? { bounds: [[w, s], [e, n]], zoom: null } : null;
  }
  // A read serves a view when its box holds the view at least as finely as the view wants.
  const holds = (read, view) => !!view?.bounds && !!read.box && read.box.x0 <= view.bounds[0][0] && read.box.y0 <= view.bounds[0][1] && read.box.x1 >= view.bounds[1][0] && read.box.y1 >= view.bounds[1][1];
  const serves = (read, view, w) => !read.truncated && read.tol <= w.tol && holds(read, view);
  // A deferred row's count, as its row lists it ("4,900 features")
  const featureCount = (n) => Number(n).toLocaleString("en-NZ") + (Number(n) === 1 ? " feature" : " features");
  const zoomLine = (name, n) => "Zoom in to see " + name + " (" + Number(n).toLocaleString("en-NZ") + ")";

  // #411 (3): where a layer came from, for the Layers line that tells same-named rows apart (HDLG lists "Farm plan: features"
  // six times). The loader records `source` as "<set or author>, <folder>/<file>" (tools/load_group.py): its file and its set,
  // "From Features areas.sqlite (JH)"; a source with no path is said as it is; with no source, the layer's own full name.
  function fromLine(layer) {
    const source = String(layer?.source || "").trim(), name = String(layer?.name || "").trim();
    if (!source) return name || null;
    const file = source.split(/[\\/]/).pop().trim();
    if (file === source || !file) return "From " + source;
    const set = source.split(/,\s*/)[0].trim();
    return "From " + file + (set && set !== source && !/[\\/]/.test(set) ? " (" + set + ")" : "");
  }
  // rows: [{ name, from, full }] as the Layers list shows them (name: the plain name; from: where it came from; full: its own full
  // name). Each row whose name another row shares gets a line, [from], or its full name where two of them came from the same
  // place; every other row gets null (a name no other row has needs no line).
  function sameNameLines(rows) {
    const items = list(rows), by = new Map();
    for (const r of items) { const k = String(r?.name ?? ""); by.set(k, (by.get(k) || 0) + 1); }
    return items.map((r) => {
      if ((by.get(String(r?.name ?? "")) || 0) < 2) return null;
      const twins = items.filter((x) => x !== r && String(x?.name ?? "") === String(r?.name ?? ""));
      const from = r?.from || null, full = r?.full || null;
      if (from && !twins.some((x) => x?.from === from)) return from;
      return full && full !== r.name && !twins.some((x) => x?.full === full) ? (from ? from + " · " + full : full) : from || full || null;
    });
  }

  // One owner's deferred layers for its session: a group's (group: its id, read with group_layer_features) or, CAP1b, a
  // farm's (farm: its id, read with farm_layer_features). layers: the map's layer entries; onData(id, featureCollection):
  // draw these features for the layer (an empty collection clears it); onChange(id, state). setTimer/clearTimer: the
  // host's (tests pass their own). States: "idle" (off, or not read), "loading", "loaded", "truncated" (too many in the
  // box: the person zooms in), "failed".
  function create({ sb, group = null, farm = null, layers = [], max = MAX_FEATURES, debounce = DEBOUNCE_MS, onData = () => {}, onChange = () => {},
    setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t) } = {}) {
    const owned = farm != null ? "farm_layer_features" : "group_layer_features";
    // Per layer: its reads kept (cache) and on their way (inflight: key -> {key, box, tol, p}); wanted: the key of the view
    // it was last asked for (view); waiting: the read that view waits on (its own, or one on its way whose box holds it);
    // queued: a view that came while IN_FLIGHT reads were out ({view, waiters}), read when one of them lands.
    const entry = (l) => ({ layer: l, on: false, cache: new Map(), inflight: new Map(), wanted: null, view: null, waiting: null, queued: null,
      drawn: null, state: "idle", error: null, total: null });
    const known = new Map(list(layers).filter(readable).map((l) => [String(l.id), entry(l)]));
    let gone = false, timer = null, lastView = null, reads = 0;
    const missingFns = new Set();   // functions the database doesn't have yet: not asked again this session
    const fnOf = (s) => s.layer.fn || owned;
    const set = (id, s, st) => { if (s.state === st) return; s.state = st; onChange(id, st); };
    // What a view wants of this layer; an item never simplified (add with simplify: false) keys its reads by box alone.
    const wantFor = (s, view) => { const w = want(view); return w && s.layer.simplify === false ? { ...w, tol: 0, key: "0" + w.key.slice(w.key.indexOf("|")) } : w; };
    async function fetchOne(id, w, s) {
      reads++;
      if (!w?.box) throw new Error("no box: a deferred layer is never read whole");   // #375 (want() never gives one)
      if (s.layer.read) return s.layer.read(w);   // an item's own read (add): {features, total, truncated}
      const args = { g: group, layer: id, x0: w.box.x0, y0: w.box.y0, x1: w.box.x1, y1: w.box.y1, tolerance_m: w.tol, max_features: max };
      // a farm's layer: the same call with the farm as its owner (farm_layer_features mirrors group_layer_features)
      const { g, ...box } = args;
      let r;
      try { r = await sb.rpc(owned, farm != null ? { f: farm, ...box } : args); } catch (e) { r = { error: e }; }
      if (r?.error) throw r.error;
      const d = r?.data;
      // null: a layer the caller can no longer read, or not the owner's: nothing to draw
      if (!d) return { features: NONE, total: 0, truncated: false };
      return { features: d.features && Array.isArray(d.features.features) ? d.features : NONE, total: Number(d.total_in_box) || 0, truncated: d.truncated === true };
    }
    // Draw what serves this view, or wait for a read on its way that will, or read it (one read per layer and box at a
    // time, at most IN_FLIGHT per layer).
    function ensure(id, view) {
      const s = known.get(id);
      if (!s || gone || !s.on) return Promise.resolve(null);
      const w = wantFor(s, view);
      if (!w) return Promise.resolve(null);   // no view yet: nothing is read (the next rest of the map reads it)
      // a view waiting for room is overtaken by this one: whoever waited for it gets this view's answer
      const waiters = s.queued?.waiters || [];
      s.queued = null;
      const pass = (p) => { if (waiters.length) p.then((r) => { for (const fn of waiters) fn(r); }); return p; };
      s.wanted = w.key; s.view = view; s.waiting = null;
      const hit = [...s.cache.values()].filter((r) => serves(r, view, w)).sort((a, b) => b.tol - a.tol)[0];
      if (hit) {
        if (s.drawn !== hit.key) { s.drawn = hit.key; onData(id, hit.features); }
        s.total = hit.total; s.error = null; set(id, s, "loaded");
        return pass(Promise.resolve(hit));
      }
      const same = s.cache.get(w.key);
      if (same?.truncated) { s.total = same.total; if (s.drawn) { s.drawn = null; onData(id, NONE); } set(id, s, "truncated"); return pass(Promise.resolve(same)); }
      if (s.inflight.has(w.key)) { s.waiting = w.key; set(id, s, "loading"); return pass(s.inflight.get(w.key).p); }
      // PERF3b's follow-up: a read already on its way whose box holds this view, at least as finely, serves it: wait for it
      const covering = [...s.inflight.values()].filter((f) => f.tol <= w.tol && holds(f, view)).sort((a, b) => b.tol - a.tol)[0];
      if (covering) { s.waiting = covering.key; set(id, s, "loading"); return pass(covering.p); }
      if (missingFns.has(fnOf(s))) { s.error = fnOf(s) + " is not available"; set(id, s, "failed"); return pass(Promise.resolve(null)); }
      // PERF3b's follow-up: while the person pans, the read on its way and the one for the latest view; a view that comes
      // while both are out waits, and only the latest such view is read when one of them lands
      if (s.inflight.size >= IN_FLIGHT) {
        s.queued = { view, waiters };
        set(id, s, "loading");
        return new Promise((res) => waiters.push(res));
      }
      return pass(read(id, s, w));
    }
    function read(id, s, w) {
      const p = fetchOne(id, w, s).then((got) => {
        s.inflight.delete(w.key);
        if (gone) return null;
        const r = { key: w.key, box: w.box, tol: w.tol, ...got };
        s.cache.set(w.key, r);
        if (s.cache.size > KEPT) s.cache.delete(s.cache.keys().next().value);
        if (!s.on) return r;
        if (s.waiting !== w.key) {
          // a newer view has been asked for meanwhile: kept, and drawn for now only if nothing of the layer is on the map yet
          if (!s.drawn && !r.truncated) { s.drawn = r.key; onData(id, r.features); }
          next(id, s);
          return r;
        }
        // a read that held the view, on its way for a bigger box, came back too full for that box: the view's own box is read
        if (r.truncated && w.key !== s.wanted) { ensure(id, s.view); return r; }
        s.total = r.total; s.error = null;
        if (r.truncated) { if (s.drawn) { s.drawn = null; onData(id, NONE); } set(id, s, "truncated"); }
        else { s.drawn = r.key; onData(id, r.features); set(id, s, "loaded"); }
        next(id, s);
        return r;
      }, (err) => {
        s.inflight.delete(w.key);
        if (gone) return null;
        if (missing(err)) missingFns.add(fnOf(s));
        if (s.waiting !== w.key) { next(id, s); return null; }
        s.error = err?.message || String(err); set(id, s, "failed");
        return null;
      });
      s.inflight.set(w.key, { key: w.key, box: w.box, tol: w.tol, p });
      s.waiting = w.key;
      set(id, s, "loading");
      return p;
    }
    // A read has landed: the view that waited for room (the latest) is read now, if the layer is still on.
    function next(id, s) {
      const q = s.queued;
      if (!q) return;
      s.queued = null;
      const done = (r) => { for (const fn of q.waiters) fn(r); };
      if (gone || !s.on) { done(null); return; }
      ensure(id, q.view).then(done);
    }
    const drop = (s) => { const q = s.queued; s.queued = null; if (q) for (const fn of q.waiters) fn(null); };
    return {
      has: (id) => known.has(String(id)), ids: () => [...known.keys()], state: (id) => known.get(String(id))?.state || "none",
      total: (id) => known.get(String(id))?.total ?? null, error: (id) => known.get(String(id))?.error || null,
      count: (id) => { const l = known.get(String(id))?.layer; return l && l.feature_count != null ? Number(l.feature_count) : null; },
      drawn: (id) => !!known.get(String(id))?.drawn,
      // The row's line: what the person reads under the layer's name (none when it is drawn, or off). name: the row's own.
      line(id, name = null) {
        const s = known.get(String(id));
        if (!s || !s.on) return "";
        return s.state === "loading" ? "Loading…" : s.state === "failed" ? "Couldn't load just now" : s.state === "truncated" ? zoomLine(name || s.layer.name || "this layer", s.total ?? s.layer.feature_count ?? 0) : "";
      },
      // CAP1b: another thing read by viewport with its own read. item: {name, feature_count, read(w) -> {features, total,
      // truncated} (w: {box, tol, key}), fn (the function it calls, for "not deployed yet"), simplify: false (keyed by box)}.
      add(id, item) { const k = String(id); if (!known.has(k)) known.set(k, entry({ ...item, id: k })); return k; },
      // Switched on: read for this view (its box; none without a view). A layer that failed is read again.
      show(id, view = null) { const s = known.get(String(id)); if (!s) return Promise.resolve(null); s.on = true; if (s.state === "failed") s.state = "idle"; return ensure(String(id), view); },
      // Switched off: nothing is read; its reads are kept for when it comes back on.
      hide(id) { const s = known.get(String(id)); if (!s) return; s.on = false; s.wanted = null; s.waiting = null; s.error = null; drop(s); set(String(id), s, "idle"); },
      // The map has rested at a new view: once it stays there `debounce` ms, every layer that is on (and not failed) is drawn for it.
      moved(view) {
        if (gone) return;
        lastView = view;
        if (timer != null) clearTimer(timer);
        timer = setTimer(() => { timer = null; if (!gone) for (const [id, s] of known) if (s.on && s.state !== "failed") ensure(id, lastView); }, debounce);
      },
      // The layers to read at open: the deferred layers the opening shows, each once, for the frame (frameOf the group's area).
      opening(show) { const on = new Set(list(show)); return [...known].filter(([, s]) => on.has(s.layer.theme)).map(([id]) => id); },
      reads: () => reads,
      // reads on their way for a layer (at most IN_FLIGHT)
      inFlight: (id) => known.get(String(id))?.inflight.size ?? 0,
      destroy() { gone = true; if (timer != null) clearTimer(timer); timer = null; for (const s of known.values()) drop(s); },
    };
  }

  return { OPENING_KINDS, MAX_FEATURES, DEBOUNCE_MS, IN_FLIGHT, STEPS, NONE, isDeferred, hasDeferred, tooMany, tooManyLine, readable, defaultShow, tolerance, boxFor, want, frameOf, holds, missing, zoomLine, featureCount, fromLine, sameNameLines, create };
});
