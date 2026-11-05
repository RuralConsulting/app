// The farm map's reference layers, read one source at a time (PERF1b). The farm draws from farm_map, which carries the
// farm's own layers only (PERF1a: its `reference` is []); each reference source's features are read with
// public.farm_reference_context(f, source) only when something switches that source on (a Layers switch, a What's due
// line, an Ask answer's layer set, a hand-set layer put back after Add a block), and kept for the farm's session. The
// Layers drawer and the Sources list need only the list and the counts: the reference_sources rows the farm space
// already reads, and public.farm_reference_counts(f) ({source_key: n}, no geometry). After the farm is drawn and the map
// is idle, the short list the standing answers most often bring up is read ahead, one at a time (config farmView.prefetch),
// never the region-wide zone polygons. A source that fails is "couldn't load just now" and is read again when next
// switched on; the farm never fails for it.
// Either side may be deployed first: with the database before PERF1a (no farm_reference_counts, farm_map's own
// `reference` filled in) the list and the features come from farm_map, as before; with farm_reference_context missing
// (PostgREST 404 / PGRST202) a source falls back to farm_map's entry for it. No DOM, no clock: the browser parts are the
// host's (farm-space.js).
// CAP1b: a source whose entry farm_reference_context could not bound comes `truncated: true` with its feature_count and no
// features (CAP1a). It is never drawn in part: its row says "Too many to show here (n), zoom in" (PROV1's wording,
// provenance-model.js TOO_MANY_ZOOM) and, switched on, it is read for the map in view (inView: public.reference_view_features
// for the box, CAP2; reference_in_view on a database before it; at most VIEW_MAX features, through group-layers.js like a deferred layer); still too many in the box and the
// row keeps the line.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./wq-model.js") : root.FP.wqModel);
  if (node) module.exports = api; else root.FP.farmReference = api;
})(typeof window === "undefined" ? globalThis : window, function (W) {
  const list = (v) => (Array.isArray(v) ? v : []);
  const count = (fc) => (Array.isArray(fc?.features) ? fc.features.length : 0);
  // What the standing answers most often bring up: Rivers (the shared waterways row, read for the map in view), bores,
  // consents and water-quality sites. config.js farmView.prefetch overrides it.
  const PREFETCH = ["rivers", "ecan-wells", "ecan-consents", "ecan-wq-sites"];
  // The region-wide zone and catchment polygons (one or two features of 4-14 k vertices each): never read ahead, even if
  // a config list names one; they are read when switched on.
  const ZONES = /(?:^|-)(?:zones?|subregions|catchments)(?:-|$)/;
  const isZone = (s) => ZONES.test(String(s?.key || "")) || /zone|catchment/i.test(String(s?.theme || ""));
  // A function the database doesn't have yet (PostgREST: 404 / PGRST202, or its "could not find the function" message; Postgres: 42883). Not "does not exist": that also
  // says a relation inside a function is missing, which is a failure to report, not a database to fall back for.
  const missing = (e) => !!e && (e.code === "PGRST202" || e.code === "42883" || e.status === 404 || /could not find the function/i.test(String(e.message || "")));

  // The served sources with features in this farm's context, by name (as farm_map listed them): {key, name, theme,
  // attribution, count}. counts: farm_reference_counts' object, or null when it could not be read (a database without
  // it): then the sources farm_map itself carried. A served source with no features here is not listed.
  function index(sources, counts, preloaded) {
    const rows = new Map(list(sources).filter((s) => s && s.key && s.serve_to_customers !== false).map((s) => [s.key, s]));
    const out = new Map();
    if (counts && typeof counts === "object") {
      for (const [key, n] of Object.entries(counts)) {
        // PERF3c: a dense source in a group's area comes as {by_viewport: true} (not counted): listed, with no count
        const k = n && typeof n === "object" && n.by_viewport === true ? null : Number(n);
        if (k !== null && !(k > 0)) continue;
        const s = rows.get(key) || list(preloaded).find((r) => r?.key === key) || { key };
        out.set(key, { key, name: s.name || key, theme: s.theme || null, attribution: s.attribution || null, count: k });
      }
    }
    for (const r of list(preloaded)) {
      if (!r?.key || out.has(r.key) || !count(r.features)) continue;
      out.set(r.key, { key: r.key, name: r.name || r.key, theme: r.theme || null, attribution: r.attribution || null, count: count(r.features) });
    }
    return [...out.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  // The reference keys a set of scene keys (farm-space.js sceneFor) asks for: those in the index. "rivers" is the shared
  // waterways row (read for the map in view as the person pans), not a reference source.
  const keysFor = (want, idx) => { const w = new Set(want || []); return list(idx).filter((s) => w.has(s.key)).map((s) => s.key); };
  // The sources a What's due line's place (or an Ask frame) needs drawn before it can be framed: those of its themes,
  // the rows its themes are governed by, and the layers it names.
  function placeKeys(place, idx, governs = {}) {
    const p = place || {}, themes = new Set(list(p.themes)), keys = new Set(list(p.layers));
    for (const t of themes) for (const k of governs[t] || []) keys.add(k);
    return list(idx).filter((s) => keys.has(s.key) || themes.has(s.theme)).map((s) => s.key);
  }

  // One farm's reference sources for its session. sb: the caller's client; farm: its id; counts / sources / preloaded as
  // index(); onArrive(entry): a source's entry has been read (draw it); onChange(key, state): a source's state changed.
  // context(key): the read of one source's entry (PERF3b: a group's map passes public.group_reference_context's); the
  // farm's farm_reference_context by default.
  function create({ sb, farm, counts = null, sources = [], preloaded = [], onArrive = () => {}, onChange = () => {}, context = null } = {}) {
    const idx = index(sources, counts, preloaded), known = new Map(idx.map((s) => [s.key, s]));
    const cache = new Map(), loading = new Map(), failed = new Map();
    let gone = false, contextMissing = false, prefetching = null;
    // farm_map's own entries (a database before PERF1a): already drawn by the Map scene, so already loaded
    for (const r of list(preloaded)) if (r?.key && known.has(r.key)) cache.set(r.key, r);
    const state = (key) => (cache.has(key) ? "loaded" : loading.has(key) ? "loading" : failed.has(key) ? "failed" : known.has(key) ? "pending" : "none");
    const fallback = (key) => list(preloaded).find((r) => r?.key === key) || { ...known.get(key), features: { type: "FeatureCollection", features: [] } };
    async function fetchOne(key) {
      if (contextMissing) return fallback(key);
      let r;
      try { r = await (context ? context(key) : sb.rpc("farm_reference_context", { f: farm, source: key })); } catch (e) { r = { error: e }; }
      if (r?.error && missing(r.error)) { contextMissing = true; return fallback(key); }
      if (r?.error) throw r.error;
      // null: not served, or the farm can no longer be read; nothing to draw
      return r?.data || { ...known.get(key), features: { type: "FeatureCollection", features: [] } };
    }
    function read(key) {
      if (cache.has(key)) return Promise.resolve(cache.get(key));
      if (loading.has(key)) return loading.get(key);
      failed.delete(key);
      const p = fetchOne(key).then((entry) => {
        loading.delete(key);
        if (gone) return null;
        const e = { ...entry, key };
        cache.set(key, e);
        onArrive(e); onChange(key, "loaded");
        return e;
      }, (err) => {
        loading.delete(key);
        if (gone) return null;
        failed.set(key, err?.message || String(err));
        onChange(key, "failed");
        return null;
      });
      loading.set(key, p);
      onChange(key, "loading");
      return p;
    }
    // Read every key asked for that this farm has and that isn't already here or on its way (a failed one again).
    const want = (keys) => Promise.all([...new Set(keys || [])].filter((k) => known.has(k) && !cache.has(k)).map(read));
    // Read ahead, one at a time: the config list's sources this farm has (never a zone polygon). "rivers" is the host's
    // (it reads the shared waterways for the map in view): readRivers is called for it. A source already here, on its
    // way or failed is skipped (failed: read again on the next switch, not behind the person's back).
    function prefetch(keys = PREFETCH, { readRivers = null } = {}) {
      if (prefetching) return prefetching;
      prefetching = (async () => {
        for (const key of list(keys)) {
          if (gone) return;
          if (key === "rivers") { if (readRivers) { try { await readRivers(); } catch { /* the Rivers row reads again when switched on */ } } continue; }
          const s = known.get(key);
          if (!s || isZone(s) || state(key) !== "pending") continue;
          await read(key);
        }
      })();
      return prefetching;
    }
    return {
      index: idx, has: (key) => known.has(key), keys: () => idx.map((s) => s.key), state, entry: (key) => cache.get(key) || null,
      failedKeys: () => [...failed.keys()], error: (key) => failed.get(key) || null, want, prefetch,
      destroy: () => { gone = true; },
    };
  }

  // ---- CAP1b: a truncated source read by viewport ------------------------------------------------------------------------
  const truncated = (entry) => !!entry && entry.truncated === true;
  // At most this many of one source's features in a box: more and the person zooms in (lower than a farm layer's 4,000:
  // reference_in_view, the read before CAP2, returned whole features; reference_view_features caps its vertices too).
  const VIEW_MAX = 1000;
  // The NZTM box (reference_in_view's) holding a box in degrees ({x0, y0, x1, y1}, as group-layers.js boxFor makes it):
  // its corners and edge midpoints projected, the smallest box round them.
  function nztmBox(b) {
    const pts = [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1], [(b.x0 + b.x1) / 2, b.y0], [(b.x0 + b.x1) / 2, b.y1], [b.x0, (b.y0 + b.y1) / 2], [b.x1, (b.y0 + b.y1) / 2]]
      .map(([x, y]) => W.lngLatToNztm(x, y));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), r = (v) => Math.round(v);
    return { bbox_xmin: r(Math.min(...xs)) - 1, bbox_ymin: r(Math.min(...ys)) - 1, bbox_xmax: r(Math.max(...xs)) + 1, bbox_ymax: r(Math.max(...ys)) + 1 };
  }
  // One source's features in a box (w: group-layers.js's {box}), as group-layers.js wants a read: {features, total,
  // truncated}. Never without a box. CAP2: public.reference_view_features (the box in degrees, bounded by construction: at most
  // max features and 300,000 vertices, simplified by the box) answers {features, total_in_box, truncated}; a database before CAP2
  // (the function missing, asked once per client) is read with reference_in_view as before, asking for max + 1 rows (max + 1
  // back is too many for the box, never drawn in part), and its refusal over its vertex cap (SQLSTATE 54000, "Too much to draw
  // in this view") is too many too, not a failure.
  const EMPTY = () => ({ type: "FeatureCollection", features: [] });
  const viewMissing = new WeakSet();
  const tooMuch = (e) => !!e && (e.code === "54000" || /too much to draw/i.test(String(e.message || "")));
  async function inView(sb, key, w, max = VIEW_MAX) {
    if (!w?.box) throw new Error("no box: a truncated source is never read whole");
    if (!viewMissing.has(sb)) {
      let v;
      try { v = await sb.rpc("reference_view_features", { source: key, x0: w.box.x0, y0: w.box.y0, x1: w.box.x1, y1: w.box.y1, max_features: max }); } catch (e) { v = { error: e }; }
      if (v?.error && missing(v.error)) viewMissing.add(sb);
      else if (v?.error) throw v.error;
      else {
        const d = v?.data;
        if (!d || typeof d !== "object") return { features: EMPTY(), total: 0, truncated: false };   // not a served source
        return { features: d.features && Array.isArray(d.features.features) ? d.features : EMPTY(), total: Number(d.total_in_box) || 0, truncated: d.truncated === true };
      }
    }
    const q = sb.rpc("reference_in_view", { ...nztmBox(w.box), sources: [key], max_rows: max + 1 });
    // only what the map needs (not the NZTM geometry) where the client can say so
    let r;
    try { r = await (typeof q?.select === "function" ? q.select("id,source_key,external_id,web_geom,props") : q); } catch (e) { r = { error: e }; }
    if (r?.error && tooMuch(r.error)) return { features: EMPTY(), total: null, truncated: true };
    if (r?.error) throw r.error;
    const rows = list(r?.data).filter((x) => x && x.source_key === key && x.web_geom);
    if (rows.length > max) return { features: EMPTY(), total: rows.length, truncated: true };
    return { features: { type: "FeatureCollection", features: rows.map((x) => ({ type: "Feature", id: x.id, geometry: typeof x.web_geom === "string" ? JSON.parse(x.web_geom) : x.web_geom,
      properties: { ...(x.props || {}), external_id: x.external_id ?? x.props?.external_id ?? null } })) }, total: rows.length, truncated: false };
  }

  return { PREFETCH, VIEW_MAX, index, keysFor, placeKeys, isZone, missing, truncated, nztmBox, inView, create };
});
